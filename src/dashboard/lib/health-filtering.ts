/**
 * Health filtering logic for dashboard health API.
 * Resolves one coherent evidence set and delegates classification to the pure
 * agent-health module.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { Effect } from 'effect';
import type { AgentRuntimeSnapshot } from '@overdeck/contracts';
import { getRuntimeSnapshot } from '../../lib/agent-runtime-mirror.js';
import {
  classifyAgentHealth,
  type AgentHealthRuntimeState,
  type PersistedAgentHealthState,
  type ResolvedPersistedAgentHealthState,
} from '../../lib/agents/health.js';
import {
  isRoleTerminal,
  type AdvancingRole,
} from '../../lib/cloister/reap-terminal-sessions.js';
import { readReviewStatusMap } from '../../lib/cloister/review-status-source.js';
import { capturePane, sessionExists } from '../../lib/tmux.js';

/**
 * Check if agent tmux session is alive.
 */
export const checkAgentHealth = (agentId: string) =>
  Effect.gen(function* () {
    const alive = yield* sessionExists(agentId);
    if (!alive) {
      return { alive: false };
    }

    const stdout = yield* capturePane(agentId, 5);

    return { alive: true, lastOutput: stdout.trim() };
  }).pipe(Effect.catch(() => Effect.succeed({ alive: false })));

function runtimeHealthState(
  runtime: AgentRuntimeSnapshot | null,
): AgentHealthRuntimeState | null {
  if (!runtime) return null;
  switch (runtime.activity) {
    case 'working':
    case 'thinking':
      return {
        state: 'active',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
    case 'waiting':
      return {
        state: 'waiting-on-human',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
    case 'idle':
      return {
        state: 'idle',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
    case 'stopped':
      return {
        state: 'stopped',
        lastActivity: runtime.lastActivity,
        contextSaturatedAt: runtime.contextSaturatedAt,
      };
  }
}

function reviewLifecycle(
  state: PersistedAgentHealthState,
): 'active' | 'warm' | 'unknown' {
  const role = state.role;
  if (role !== 'review' && role !== 'test' && role !== 'ship') return 'unknown';
  if (!state.issueId) return 'unknown';
  const statuses = readReviewStatusMap();
  if (!statuses) return 'unknown';
  const status = statuses[state.issueId.toUpperCase()];
  if (!status) return 'unknown';
  return isRoleTerminal(role as AdvancingRole, status) ? 'warm' : 'active';
}

async function resolvePersistedState(
  stateFile: string,
): Promise<ResolvedPersistedAgentHealthState> {
  if (!existsSync(stateFile)) {
    return {
      status: 'unavailable',
      reason: 'Agent state file is missing.',
    };
  }

  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        status: 'unavailable',
        reason: 'Agent state file does not contain an object.',
      };
    }
    return {
      status: 'available',
      value: parsed as PersistedAgentHealthState,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error
        ? `Agent state could not be read: ${error.message}`
        : 'Agent state could not be read.',
    };
  }
}

/**
 * Resolve persisted/runtime/lifecycle evidence and return the legacy adapter
 * shape consumed by the current route. Rich V2 snapshots are produced by
 * classifyAgentHealth and will be exposed directly by the route migration.
 *
 * `liveSessions` is required and must be fetched once per request. Iterating
 * agent directories and spawning a tmux subprocess per entry previously pinned
 * the dashboard process on every health poll.
 */
export const determineHealthStatus = (
  agentId: string,
  stateFile: string,
  liveSessions: Set<string>,
) =>
  Effect.gen(function* () {
    const persisted = yield* Effect.promise(() => resolvePersistedState(stateFile));
    const runtime = yield* getRuntimeSnapshot(agentId);
    const lifecycle = persisted.status === 'available'
      ? reviewLifecycle(persisted.value)
      : 'unknown';
    const snapshot = classifyAgentHealth({
      agentId,
      persisted,
      runtime: runtimeHealthState(runtime),
      liveSessions,
      reviewLifecycle: lifecycle,
      nowMs: Date.now(),
    });
    const firstReason = snapshot.reasons[0]?.message;
    return {
      status: snapshot.status,
      ...(firstReason ? { reason: firstReason } : {}),
    };
  });
