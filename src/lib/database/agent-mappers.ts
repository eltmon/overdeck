/**
 * AgentState <-> SQLite agents row mappers (PAN-1908).
 *
 * Kept in a dedicated module so backfill/migration code can use the same
 * mapping as the runtime without creating a runtime dependency on
 * src/lib/agents.ts (which would cause a circular ESM import through the
 * database initialization path).
 */

import type { AgentState } from '../agents.js';
import type { Agent as DbAgent } from './agents-db.js';

export function agentStateToDbAgent(state: AgentState): DbAgent {
  return {
    id: state.id,
    issueId: state.issueId,
    role: state.role,
    status: state.status,
    workspace: state.workspace,
    harness: state.harness ?? null,
    model: state.model ?? null,
    branch: state.branch ?? null,
    sessionId: state.sessionId ?? null,
    startedAt: state.startedAt ?? null,
    lastActivity: state.lastActivity ?? null,
    lastResumeAt: state.lastResumeAt ?? null,
    stoppedAt: state.stoppedAt ?? null,
    stoppedByUser: state.stoppedByUser ?? null,
    stoppedByPause: state.stoppedByPause ?? null,
    kickoffDelivered: state.kickoffDelivered ?? null,
    hostOverride: state.hostOverride ?? null,
    costSoFar: state.costSoFar ?? null,
    phase: state.phase ?? null,
    workType: state.workType ?? null,
    paused: state.paused ?? null,
    pausedReason: state.pausedReason ?? null,
    pausedAt: state.pausedAt ?? null,
    troubled: state.troubled ?? null,
    troubledAt: state.troubledAt ?? null,
    consecutiveFailures: state.consecutiveFailures ?? null,
    firstFailureInRunAt: state.firstFailureInRunAt ?? null,
    lastFailureAt: state.lastFailureAt ?? null,
    lastFailureReason: state.lastFailureReason ?? null,
    lastFailureNextRetryAt: state.lastFailureNextRetryAt ?? null,
    flywheelRunId: state.flywheelRunId ?? null,
    roleRunHead: state.roleRunHead ?? null,
    reviewSubRole: state.reviewSubRole ?? null,
    reviewRunId: state.reviewRunId ?? null,
    reviewSynthesisAgentId: state.reviewSynthesisAgentId ?? null,
    reviewOutputPath: state.reviewOutputPath ?? null,
    reviewDeadlineAt: state.reviewDeadlineAt ?? null,
    reviewMonitorSignaled: state.reviewMonitorSignaled ?? null,
    reviewRetryAttempt: state.reviewRetryAttempt ?? null,
    inspectSubRole: state.inspectSubRole ?? null,
    deliveryMethod: state.deliveryMethod ?? null,
    supervisorEnabled: state.supervisorEnabled ?? null,
    channelsEnabled: state.channelsEnabled ?? null,
    updatedAt: new Date().toISOString(),
  };
}
