import { readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import type { AgentRuntimeSnapshot } from '@overdeck/contracts';
import type { RuntimeName } from '../runtimes/types.js';
import {
  getAgentRuntimeSnapshot as fetchAgentRuntimeSnapshot,
  emitAgentEvent,
} from '../agent-runtime.js';
import { getRuntimeSnapshot, isAgentStateServiceInProcess } from '../agent-runtime-mirror.js';
import { normalizeHarness } from '../overdeck/conversations.js';
import { getAgentDir } from '../agents.js';

export type AgentResolution = 'working' | 'done' | 'needs_input' | 'stuck' | 'completed' | 'unclear' | 'abandoned';

/** Callers consume this shape; data comes from AgentRuntimeSnapshot. */
export interface AgentRuntimeState {
  // 'suspended' retained for backward-compat with callers that still compare
  // against it defensively. The new event path never emits suspended — PAN-800
  // drops the auto-suspend feature; PAN-188 reintroduces it.
  state: 'active' | 'idle' | 'suspended' | 'stopped' | 'uninitialized' | 'waiting-on-human';
  lastActivity: string;
  currentTool?: string;
  claudeSessionId?: string;
  sessionModel?: string;
  sessionHarness?: RuntimeName;
  /**
   * For specialists: the issue currently being processed. Tracked per-agent in
   * the AgentStateService snapshot (see agent.current_issue_set event).
   */
  currentIssue?: string;
  resolution?: AgentResolution;
  resolutionCount?: number;
  resolutionUpdatedAt?: string;
  waitingReason?: string;
  waitingStartedAt?: string;
  waitingNotification?: string;
  contextSaturatedAt?: string;
}

export function sessionResumeDriftReasons(
  runtimeState: AgentRuntimeState | null,
  model: string,
  harness: RuntimeName,
): string[] {
  if (!runtimeState?.sessionModel || !runtimeState.sessionHarness) return [];
  const reasons: string[] = [];
  if (runtimeState.sessionModel !== model) {
    reasons.push(`model ${runtimeState.sessionModel}→${model}`);
  }
  if (runtimeState.sessionHarness !== harness) {
    reasons.push(`harness ${runtimeState.sessionHarness}→${harness}`);
  }
  return reasons;
}

function snapshotToRuntimeState(snap: AgentRuntimeSnapshot | null): AgentRuntimeState | null {
  if (!snap) return null;
  // Map Activity → legacy state. The legacy 'active' value collapses working
  // and thinking — neither consumer ever distinguished them.
  let state: AgentRuntimeState['state'];
  switch (snap.activity) {
    case 'working': state = 'active'; break;
    case 'thinking': state = 'active'; break;
    case 'idle': state = 'idle'; break;
    case 'stopped': state = 'stopped'; break;
    case 'waiting': state = 'waiting-on-human'; break;
    default: state = 'uninitialized';
  }
  return {
    state,
    lastActivity: snap.lastActivity,
    currentTool: snap.currentTool,
    claudeSessionId: snap.claudeSessionId,
    sessionModel: snap.sessionModel,
    sessionHarness: normalizeHarness(snap.sessionHarness ?? null) ?? undefined,
    currentIssue: snap.currentIssue,
    resolution: snap.resolution as AgentResolution | undefined,
    resolutionCount: snap.resolutionCount,
    resolutionUpdatedAt: snap.resolutionUpdatedAt,
    waitingReason: snap.waiting?.reason,
    waitingStartedAt: snap.waiting?.startedAt,
    waitingNotification: snap.waiting?.message,
    contextSaturatedAt: snap.contextSaturatedAt,
  };
}

export function getAgentRuntimeStateSync(agentId: string): AgentRuntimeState | null {
  // Sync path: read from the in-process mirror (empty in fresh CLI processes,
  // populated inside the dashboard server). CLI commands should use
  // getAgentRuntimeStateProgram so they fall through to HTTP.
  return snapshotToRuntimeState(Effect.runSync(getRuntimeSnapshot(agentId)));
}

export const getAgentRuntimeState = (agentId: string): Effect.Effect<AgentRuntimeState | null> =>
  Effect.gen(function* () {
    if (yield* isAgentStateServiceInProcess()) {
      return snapshotToRuntimeState(yield* getRuntimeSnapshot(agentId));
    }

    const snap = yield* fetchAgentRuntimeSnapshot(agentId);
    return snapshotToRuntimeState(snap);
  });

async function patchRuntimeJson(agentId: string, patch: Partial<AgentRuntimeState>): Promise<void> {
  const agentDir = getAgentDir(agentId);
  const runtimeFile = join(agentDir, 'runtime.json');
  let runtime: Record<string, unknown> = {};

  try {
    runtime = JSON.parse(await readFile(runtimeFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    runtime = {};
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'contextSaturatedAt')) {
    if (patch.contextSaturatedAt === undefined) {
      delete runtime.contextSaturatedAt;
    } else {
      runtime.contextSaturatedAt = patch.contextSaturatedAt;
    }
  }

  await mkdir(agentDir, { recursive: true });
  await writeFile(runtimeFile, JSON.stringify(runtime, null, 2));
}

/**
 * Emit events derived from a legacy-shape patch. Callers gradually migrate to
 * direct emitAgentEvent calls; this adapter keeps existing code working.
 */
export async function saveAgentRuntimeState(agentId: string, patch: Partial<AgentRuntimeState>): Promise<void> {
  if (patch.currentIssue !== undefined) {
    await Effect.runPromise(emitAgentEvent(agentId, {
      kind: 'current_issue_set',
      currentIssue: patch.currentIssue || undefined,
    }));
  }

  if (patch.resolution !== undefined && patch.resolutionCount !== undefined) {
    await Effect.runPromise(emitAgentEvent(agentId, {
      kind: 'resolution_set',
      resolution: patch.resolution,
      resolutionCount: patch.resolutionCount,
    }));
  }

  if (patch.state !== undefined) {
    if (patch.state === 'waiting-on-human') {
      await Effect.runPromise(emitAgentEvent(agentId, {
        kind: 'waiting_start',
        reason: (patch.waitingReason as 'tool_permission' | 'user_question' | 'disambiguation' | 'other') || 'other',
        message: patch.waitingNotification,
      }));
    } else if (patch.state === 'active') {
      await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'working', tool: patch.currentTool }));
    } else if (patch.state === 'idle') {
      await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'idle' }));
    } else if (patch.state === 'stopped') {
      await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'stopped' }));
    }
  } else if (patch.currentTool !== undefined) {
    await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'working', tool: patch.currentTool }));
  }

  if (patch.claudeSessionId || patch.sessionModel !== undefined || patch.sessionHarness !== undefined) {
    // model_set requires a model — use existing snapshot's model if present.
    const snap = getAgentRuntimeStateSync(agentId);
    if (snap || patch.claudeSessionId || patch.sessionModel !== undefined || patch.sessionHarness !== undefined) {
      const event: {
        kind: 'model_set';
        model: string;
        claudeSessionId?: string;
        sessionModel?: string;
        sessionHarness?: RuntimeName;
      } = {
        kind: 'model_set',
        model: 'unknown',
      };
      if (patch.claudeSessionId !== undefined) event.claudeSessionId = patch.claudeSessionId;
      if (patch.sessionModel !== undefined) event.sessionModel = patch.sessionModel;
      if (patch.sessionHarness !== undefined) event.sessionHarness = patch.sessionHarness;
      await Effect.runPromise(emitAgentEvent(agentId, {
        ...event,
      }));
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'contextSaturatedAt')) {
    await patchRuntimeJson(agentId, patch);
    await Effect.runPromise(emitAgentEvent(agentId, {
      kind: 'context_saturation_changed',
      contextSaturatedAt: patch.contextSaturatedAt,
    }));
  }
}
