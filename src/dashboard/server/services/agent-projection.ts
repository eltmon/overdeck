/**
 * Agent lifecycle projection — event emission only (PAN-3917 W6, FR-12).
 *
 * This used to be a write-through transactional boundary: every lifecycle
 * transition wrote `state.json`, upserted the `agents` and `issues` rows in
 * overdeck.db, and appended the event, all in one SQLite transaction, so the
 * three copies could not drift.
 *
 * There are no copies any more. Session liveness and state come from the
 * terminal backend (`services/backend-inventory.ts`), so the mirror rows and
 * the runtime half of `state.json` are gone and nothing needs reconciling.
 * What survives is the event: the dashboard's read model and every subscriber
 * are fed from the event store, and that path is unchanged.
 *
 * `AgentState` is still the argument shape because callers hold one and its
 * permanent fields (issueId, workspace, harness, model, role) are what the
 * event payload carries. Its runtime fields are no longer written anywhere.
 */

import { Effect } from 'effect';
import { getEventStore, type EventStore } from '../event-store.js';
import { getAgentStateSync, type AgentState } from '../../../lib/agents.js';
import { logAgentLifecycleSync } from '../../../lib/persistent-logger.js';
import { sessionFilePath } from '../../../lib/paths.js';
import {
  getConversationByTmuxSession,
  markConversationEnded,
  markConversationRunning,
  type LegacyConversation,
} from '../../../lib/overdeck/conversations.js';
import { getBackendPanes } from './backend-inventory.js';
import { cleanupUnreferencedConversationAttachments } from './conversation-attachments.js';
import { isRespawnPending } from './pending-respawn.js';
import type { DomainEvent } from '@overdeck/contracts';

export interface AgentProjectionResult {
  /** Assigned event sequence number. */
  sequence: number;
}

/** Only the door this module uses, so tests can pass a stub. */
type AgentProjectionEventStore = Pick<EventStore, 'append'>;

/**
 * Append an agent lifecycle event. The event store stamps `workspaceId` and
 * emits to subscribers itself, so this is a thin, named wrapper that also
 * writes the persistent lifecycle log line.
 */
export function saveAgentStateAndEmitEventWithDeps(
  eventStore: AgentProjectionEventStore,
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): AgentProjectionResult {
  const sequence = eventStore.append(event);
  logAgentLifecycleSync(
    state.id,
    `projected ${event.type} (seq=${sequence}) for ${state.id}`,
  );
  return { sequence };
}

export function saveAgentStateAndEmitEvent(
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): AgentProjectionResult {
  return saveAgentStateAndEmitEventWithDeps(getEventStore(), state, event);
}

/**
 * Effect wrapper for server routes. Runs the synchronous append under
 * Effect.sync so callers in Effect.gen can compose it without blocking.
 */
export function saveAgentStateAndEmitEventProgram(
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): Effect.Effect<AgentProjectionResult> {
  return Effect.sync(() => saveAgentStateAndEmitEvent(state, event));
}

// ─── PTY-supervisor lifecycle events (PAN-3849 W33, PAN-3962) ───────────────
//
// The PTY supervisor observes the harness process directly (it owns the PTY
// master), so ITS events are the source for running/stopped transitions of
// supervisor-launched sessions. The supervised id is the terminal session
// name: an agent id (`agent-…`, `planning-…`) or a conversation's tmux session
// (`conv-<name>`). Agents append an event and write no status anywhere.
// Conversations still keep `status`/`ended_at` on their overdeck.db row, so a
// conversation's lifecycle event writes that row and appends the runtime
// activity keyed by the same id its hooks report under.

export type AgentLifecycleEventName = 'session-started' | 'turn-started' | 'turn-ended' | 'exited';

export interface AgentLifecycleEventInput {
  event: AgentLifecycleEventName;
  at: string;
  exitCode?: number;
}

export type AgentLifecycleApplyResult =
  | { applied: true; status: 'running' | 'stopped' | 'unknown' }
  | { applied: false; reason: 'no-state' | 'already-stopped' | 'duplicate' | 'respawn-pending' };

/**
 * The event payload's agent snapshot. `status` is the event's own meaning at
 * emission time (agent.started means running), not a status read from a
 * mirror — it is carried because the read model's AgentSnapshot requires it.
 */
function snapshotFromState(state: AgentState, status: 'running' | 'stopped') {
  return {
    id: state.id,
    issueId: state.issueId,
    status,
    ...(state.workspace ? { workspace: state.workspace } : {}),
    ...(state.harness ? { runtime: state.harness } : {}),
    ...(state.model ? { model: state.model } : {}),
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
    ...(state.startedBy ? { startedBy: state.startedBy } : {}),
    ...(state.role ? { role: state.role } : {}),
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
  };
}

/**
 * Idempotency ring for supervisor retries. The supervisor builds one request
 * body and re-POSTs it after a failure, so a retry carries the same `at` as
 * the already-appended event. This used to be answered by comparing
 * `state.stoppedAt` on the mirror; it is an in-memory dedupe now, because a
 * delivery detail is not a fact worth persisting.
 */
const RECENT_LIFECYCLE_KEYS_MAX = 512;
const recentLifecycleKeys = new Set<string>();

function rememberLifecycleKey(key: string): boolean {
  if (recentLifecycleKeys.has(key)) return false;
  recentLifecycleKeys.add(key);
  if (recentLifecycleKeys.size > RECENT_LIFECYCLE_KEYS_MAX) {
    const oldest = recentLifecycleKeys.values().next().value;
    if (oldest !== undefined) recentLifecycleKeys.delete(oldest);
  }
  return true;
}

/** Test seam: forget the dedupe ring between cases. */
export function _resetAgentLifecycleDedupeForTests(): void {
  recentLifecycleKeys.clear();
}

export interface AgentLifecycleDeps {
  /** Permanent facts for the event payload (issue, workspace, harness, model). */
  readonly readAgentState?: (agentId: string) => AgentState | null;
  /** True when the backend reports this agent's pane already exited. */
  readonly hasExited?: (agentId: string) => Promise<boolean>;
  /** The conversation supervised under this terminal session id, if any. */
  readonly readConversation?: (sessionId: string) => LegacyConversation | null;
  /** True while a respawn (kill → spawn under the same name) is in flight. */
  readonly isRespawnPending?: (sessionId: string) => boolean;
  readonly markConversationRunning?: (name: string) => void;
  readonly markConversationEnded?: (name: string, endedAtMs?: number) => void;
  /** Attachment cleanup for a conversation that just ended (the poller's cleanup). */
  readonly cleanupEndedConversation?: (conversation: LegacyConversation) => Promise<void>;
}

/**
 * The cleanup the conversation poller runs on rows it marks ended. The
 * supervisor's exit now marks the row ended first, and the poller skips rows
 * already ended, so the exit path must run it. Never throws.
 */
async function cleanupEndedConversationAttachments(conversation: LegacyConversation): Promise<void> {
  const sessionFile = conversation.claudeSessionId
    ? sessionFilePath(conversation.cwd, conversation.claudeSessionId)
    : null;
  await cleanupUnreferencedConversationAttachments({ name: conversation.name, sessionFile });
}

/**
 * The conversation whose supervised tmux session is `sessionId`. Only an exact
 * tmux-session match counts: `getConversationByTmuxSession` also resolves a
 * bare name, and a lifecycle event must never land on a row it does not own.
 */
function readSupervisedConversation(sessionId: string): LegacyConversation | null {
  const conversation = getConversationByTmuxSession(sessionId);
  return conversation && conversation.tmuxSession === sessionId ? conversation : null;
}

async function paneAlreadyExited(agentId: string): Promise<boolean> {
  const panes = await getBackendPanes();
  const pane = panes.find((candidate) => candidate.id === agentId || candidate.terminalId === agentId);
  return pane?.state === 'exited';
}

export async function applyAgentLifecycleEventWithDeps(
  eventStore: AgentProjectionEventStore,
  agentId: string,
  input: AgentLifecycleEventInput,
  deps: AgentLifecycleDeps = {},
): Promise<AgentLifecycleApplyResult> {
  const state = (deps.readAgentState ?? getAgentStateSync)(agentId);
  if (!state) {
    const conversation = (deps.readConversation ?? readSupervisedConversation)(agentId);
    if (!conversation) return { applied: false, reason: 'no-state' };
    return applyConversationLifecycleEvent(eventStore, agentId, conversation, input, deps);
  }
  const at = input.at;

  if (!rememberLifecycleKey(`${agentId}:${input.event}:${at}`)) {
    return { applied: false, reason: 'duplicate' };
  }

  switch (input.event) {
    case 'session-started': {
      // agent.started is emitted HERE — when the harness process actually
      // exists — and nowhere earlier. A late event must not resurrect an agent
      // whose pane the backend already reports as exited.
      if (await (deps.hasExited ?? paneAlreadyExited)(agentId)) {
        return { applied: false, reason: 'already-stopped' };
      }
      saveAgentStateAndEmitEventWithDeps(eventStore, state, {
        type: 'agent.started',
        timestamp: at,
        payload: { agentId, issueId: state.issueId, agent: snapshotFromState(state, 'running') },
      });
      return { applied: true, status: 'running' };
    }
    case 'turn-started':
    case 'turn-ended': {
      saveAgentStateAndEmitEventWithDeps(eventStore, state, {
        type: 'agent.activity_changed',
        timestamp: at,
        payload: { agentId, activity: input.event === 'turn-started' ? 'working' : 'idle' },
      });
      return { applied: true, status: 'unknown' };
    }
    case 'exited': {
      saveAgentStateAndEmitEventWithDeps(eventStore, state, {
        type: 'agent.stopped',
        timestamp: at,
        payload: {
          agentId,
          issueId: state.issueId,
          ...(state.sessionId ? { sessionId: state.sessionId } : {}),
        },
      });
      return { applied: true, status: 'stopped' };
    }
  }
}

/**
 * A supervised conversation's lifecycle (PAN-3962). The row's `status` is the
 * conversation's recorded state, so the supervisor's own observation writes
 * it: `session-started` marks it active, `exited` marks it ended at the exit
 * time. Turn edges and the exit are also appended as `agent.activity_changed`
 * keyed by the tmux session id — the id the conversation's hooks already
 * report activity under — so the read model can tell idle from working.
 * `agent.started`/`agent.stopped` are not emitted: conversations are not
 * agents and carry no issue id.
 */
async function applyConversationLifecycleEvent(
  eventStore: AgentProjectionEventStore,
  sessionId: string,
  conversation: LegacyConversation,
  input: AgentLifecycleEventInput,
  deps: AgentLifecycleDeps,
): Promise<AgentLifecycleApplyResult> {
  const at = input.at;
  if (!rememberLifecycleKey(`${sessionId}:${input.event}:${at}`)) {
    return { applied: false, reason: 'duplicate' };
  }

  const appendActivity = (activity: 'working' | 'idle' | 'stopped') => {
    const sequence = eventStore.append({
      type: 'agent.activity_changed',
      timestamp: at,
      payload: { agentId: sessionId, activity },
    });
    logAgentLifecycleSync(
      sessionId,
      `projected agent.activity_changed(${activity}) (seq=${sequence}) for conversation ${conversation.name}`,
    );
  };

  switch (input.event) {
    case 'session-started': {
      // Same guard as agents: a late event must not resurrect a session whose
      // pane the backend already reports as exited.
      if (await (deps.hasExited ?? paneAlreadyExited)(sessionId)) {
        return { applied: false, reason: 'already-stopped' };
      }
      (deps.markConversationRunning ?? markConversationRunning)(conversation.name);
      appendActivity('idle');
      return { applied: true, status: 'running' };
    }
    case 'turn-started':
    case 'turn-ended': {
      appendActivity(input.event === 'turn-started' ? 'working' : 'idle');
      return { applied: true, status: 'unknown' };
    }
    case 'exited': {
      // A respawn (resume, model switch) kills the old harness and spawns a
      // new one under the same session name. The old supervisor's exit lands
      // inside that window and must not end the conversation being revived.
      if ((deps.isRespawnPending ?? isRespawnPending)(sessionId)) {
        return { applied: false, reason: 'respawn-pending' };
      }
      const exitedAtMs = Date.parse(at);
      (deps.markConversationEnded ?? markConversationEnded)(
        conversation.name,
        Number.isNaN(exitedAtMs) ? undefined : exitedAtMs,
      );
      appendActivity('stopped');
      try {
        await (deps.cleanupEndedConversation ?? cleanupEndedConversationAttachments)(conversation);
      } catch (err: unknown) {
        // The exit is recorded; a cleanup failure must never fail the route.
        console.error(`[agent-projection] Attachment cleanup failed for conversation ${conversation.name}:`, err);
      }
      return { applied: true, status: 'stopped' };
    }
  }
}

export function applyAgentLifecycleEvent(
  agentId: string,
  input: AgentLifecycleEventInput,
  deps: AgentLifecycleDeps = {},
): Promise<AgentLifecycleApplyResult> {
  return applyAgentLifecycleEventWithDeps(getEventStore(), agentId, input, deps);
}
