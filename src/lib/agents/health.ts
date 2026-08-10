import type {
  AgentHealthKind,
  AgentHealthSnapshot,
  HealthReason,
  SpecialistLifecycle,
} from '@overdeck/contracts';

const STARTUP_GRACE_MS = 5 * 60 * 1000;
const ACTIVITY_WARNING_MS = 15 * 60 * 1000;
export const ACTIVITY_STALLED_MS = 30 * 60 * 1000;

export interface PersistedAgentHealthState {
  id?: string;
  issueId?: string;
  role?: string;
  status?: string;
  startedAt?: string;
  lastActivity?: string;
  kickoffDelivered?: boolean;
  paused?: boolean;
  stoppedByUser?: boolean;
  stoppedByPause?: boolean;
  consecutiveFailures?: number;
}

export type ResolvedPersistedAgentHealthState =
  | { status: 'available'; value: PersistedAgentHealthState }
  | { status: 'unavailable'; reason: string };

export interface AgentHealthRuntimeState {
  state:
    | 'active'
    | 'idle'
    | 'suspended'
    | 'stopped'
    | 'uninitialized'
    | 'waiting-on-human';
  lastActivity?: string;
  contextSaturatedAt?: string;
}

export interface AgentHealthObservations {
  consecutiveFailures?: number;
  killCount?: number;
  contextPercent?: number | null;
}

export interface ClassifyAgentHealthInput {
  agentId: string;
  persisted: ResolvedPersistedAgentHealthState;
  runtime: AgentHealthRuntimeState | null;
  liveSessions: ReadonlySet<string>;
  reviewLifecycle?: SpecialistLifecycle;
  observations?: AgentHealthObservations;
  nowMs: number;
}

function reason(
  code: string,
  severity: HealthReason['severity'],
  message: string,
): HealthReason {
  return { code, domain: 'agent', severity, message };
}

function validTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function latestActivity(
  persisted: PersistedAgentHealthState,
  runtime: AgentHealthRuntimeState | null,
): string | undefined {
  const candidates = [persisted.lastActivity, runtime?.lastActivity]
    .map((value) => ({ value, timestamp: validTimestamp(value) }))
    .filter((entry): entry is { value: string; timestamp: number } =>
      entry.value !== undefined && entry.timestamp !== null
    );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, entry) =>
    entry.timestamp > latest.timestamp ? entry : latest
  ).value;
}

function agentKind(role: string | undefined): AgentHealthKind {
  if (role === 'work') return 'work';
  if (role === 'plan') return 'planning';
  if (role === 'review' || role === 'test' || role === 'ship') return 'specialist';
  return 'other';
}

function humanizeInactivity(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  const hours = minutes / 60;
  if (hours < 72) {
    return `${Math.round(hours)} h`;
  }
  const days = hours / 24;
  return `${Math.round(days)} d`;
}

function intentionalInactive(state: PersistedAgentHealthState): boolean {
  return state.status === 'stopped'
    || state.status === 'completed'
    || state.paused === true
    || state.stoppedByUser === true
    || state.stoppedByPause === true;
}

function lifecycleFor(
  input: ClassifyAgentHealthInput,
  state: PersistedAgentHealthState,
): SpecialistLifecycle {
  if (input.reviewLifecycle === 'warm' || input.reviewLifecycle === 'orphaned') {
    return input.reviewLifecycle;
  }
  if (input.liveSessions.has(input.agentId) && !intentionalInactive(state)) return 'active';
  return input.reviewLifecycle ?? 'unknown';
}

function buildSnapshot(
  input: ClassifyAgentHealthInput,
  state: PersistedAgentHealthState,
  status: AgentHealthSnapshot['status'],
  reasons: HealthReason[],
): AgentHealthSnapshot {
  const lastActivityAt = latestActivity(state, input.runtime);
  const observations = input.observations;
  return {
    id: input.agentId,
    ...(state.issueId ? { issueId: state.issueId } : {}),
    ...(state.role ? { role: state.role } : {}),
    kind: agentKind(state.role),
    status,
    lifecycle: lifecycleFor(input, state),
    tmuxActive: input.liveSessions.has(input.agentId),
    ...(lastActivityAt ? { lastActivityAt } : {}),
    ...(observations?.consecutiveFailures !== undefined
      ? { consecutiveFailures: observations.consecutiveFailures }
      : state.consecutiveFailures !== undefined
        ? { consecutiveFailures: state.consecutiveFailures }
        : {}),
    ...(observations?.killCount !== undefined ? { killCount: observations.killCount } : {}),
    ...(observations && Object.prototype.hasOwnProperty.call(observations, 'contextPercent')
      ? { contextPercent: observations.contextPercent ?? null }
      : {}),
    reasons,
  };
}

/**
 * Classifies one resolved agent snapshot. The function is intentionally free of
 * filesystem, tmux, review-status, and runtime-store imports so every caller
 * supplies one coherent set of evidence and cycle-prone dashboard code remains
 * a thin resolver adapter.
 */
export function classifyAgentHealth(
  input: ClassifyAgentHealthInput,
): AgentHealthSnapshot {
  if (input.persisted.status === 'unavailable') {
    return buildSnapshot(
      input,
      {},
      'unavailable',
      [reason(
        'agent.persisted_state.unavailable',
        'warning',
        input.persisted.reason,
      )],
    );
  }

  const state = input.persisted.value;
  if (input.runtime?.contextSaturatedAt) {
    return buildSnapshot(input, state, 'wedged', [reason(
      'agent.context.saturated',
      'critical',
      'Context window exhausted; recovery is required.',
    )]);
  }

  const startedAt = validTimestamp(state.startedAt);
  const startupGraceElapsed = startedAt !== null
    && input.nowMs - startedAt >= STARTUP_GRACE_MS;
  const expectsLiveSession = state.status === 'running' || state.status === 'starting';
  const tmuxActive = input.liveSessions.has(input.agentId);
  if (!tmuxActive && expectsLiveSession && startupGraceElapsed) {
    return buildSnapshot(input, state, 'dead', [reason(
      'agent.tmux.missing',
      'critical',
      'The persisted agent is running but its tmux session is missing.',
    )]);
  }

  if (
    state.role === 'work'
    && state.status === 'running'
    && state.kickoffDelivered === false
    && startupGraceElapsed
  ) {
    return buildSnapshot(input, state, 'stalled', [reason(
      'agent.kickoff.not_delivered',
      'warning',
      'Work agent running with no kickoff delivered since spawn',
    )]);
  }

  if (input.runtime?.state === 'waiting-on-human') {
    return buildSnapshot(input, state, 'waiting', [reason(
      'agent.runtime.waiting_on_human',
      'info',
      'The agent is waiting for operator input.',
    )]);
  }

  if (
    (input.reviewLifecycle === 'warm' || input.reviewLifecycle === 'orphaned')
    || input.runtime?.state === 'idle'
    || input.runtime?.state === 'suspended'
    || input.runtime?.state === 'stopped'
    || intentionalInactive(state)
  ) {
    return buildSnapshot(input, state, 'idle', []);
  }

  if (input.runtime?.state === 'active') {
    const lastActivityAt = latestActivity(state, input.runtime);
    const lastActivityMs = validTimestamp(lastActivityAt);
    if (lastActivityMs !== null) {
      const inactivityMs = Math.max(0, input.nowMs - lastActivityMs);
      if (inactivityMs >= ACTIVITY_STALLED_MS) {
        return buildSnapshot(input, state, 'stalled', [reason(
          'agent.runtime.inactive.stalled',
          'warning',
          `${input.agentId} has produced no activity for ${humanizeInactivity(inactivityMs)}.`,
        )]);
      }
      if (inactivityMs >= ACTIVITY_WARNING_MS) {
        return buildSnapshot(input, state, 'warning', [reason(
          'agent.runtime.inactive.warning',
          'warning',
          `${input.agentId} has produced no activity for ${humanizeInactivity(inactivityMs)}.`,
        )]);
      }
    }
  }

  return buildSnapshot(input, state, 'healthy', []);
}
