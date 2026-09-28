/**
 * Agent status event payloads shared by every process that registers a
 * deacon-lite notifier (deacon-main.ts, main.ts). PAN-4300: one copy, so the
 * two registrations cannot drift.
 */
import type { DomainEvent } from '@overdeck/contracts';
import type { AgentState } from '../agents/agent-state-read.js';

export type AgentStatusPayload = 'starting' | 'running' | 'stopped' | 'error' | 'unknown';

export function toAgentStatusPayload(status: AgentState['status'] | undefined): AgentStatusPayload {
  return status === 'starting' || status === 'running' || status === 'stopped' || status === 'error'
    ? status
    : 'unknown';
}

export function buildAgentStatusChangedPayload(
  state: AgentState,
  previousStatus?: AgentState['status'],
  hasLiveTmuxSession?: boolean,
) {
  const payload = {
    agentId: state.id,
    issueId: state.issueId,
    status: toAgentStatusPayload(state.status),
    previousStatus: previousStatus ? toAgentStatusPayload(previousStatus) : undefined,
    stoppedByUser: state.stoppedByUser === true,
    paused: state.paused === true,
    pausedReason: state.pausedReason ?? null,
    pausedAt: state.pausedAt ?? null,
    troubled: state.troubled === true,
    troubledAt: state.troubledAt ?? null,
    consecutiveFailures: state.consecutiveFailures ?? 0,
    firstFailureInRunAt: state.firstFailureInRunAt ?? null,
    lastFailureAt: state.lastFailureAt ?? null,
    lastFailureReason: state.lastFailureReason ?? null,
    lastFailureNextRetryAt: state.lastFailureNextRetryAt ?? null,
  };
  // `hasLiveTmuxSession` is the deprecated alias of `hasLivePane` (#4105).
  return hasLiveTmuxSession === undefined ? payload : { ...payload, hasLivePane: hasLiveTmuxSession, hasLiveTmuxSession };
}

/**
 * The events for an agent deacon-lite confirmed dead. With a state.json:
 * `agent.heartbeat_dead` then `agent.status_changed` recording the transition
 * from the recorded status to `stopped` with no live pane. Without one: only
 * `agent.heartbeat_dead`. The state.json itself is not changed.
 */
export function buildConfirmedDeadAgentEvents(
  agentId: string,
  state: AgentState | null,
  now: () => string = () => new Date().toISOString(),
): Array<Omit<DomainEvent, 'sequence'>> {
  if (!state) {
    return [{ type: 'agent.heartbeat_dead', timestamp: now(), payload: { agentId } } as Omit<DomainEvent, 'sequence'>];
  }
  return [
    { type: 'agent.heartbeat_dead', timestamp: now(), payload: { agentId, issueId: state.issueId, sessionId: state.sessionId } } as Omit<DomainEvent, 'sequence'>,
    {
      type: 'agent.status_changed',
      timestamp: now(),
      payload: buildAgentStatusChangedPayload({ ...state, status: 'stopped' }, state.status, false),
    } as Omit<DomainEvent, 'sequence'>,
  ];
}
