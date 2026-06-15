/**
 * Agents SQLite Storage (PAN-1908)
 *
 * CRUD operations for the agents table — the authoritative runtime registry
 * that replaces state.json enumeration.
 *
 * PAN-1249: Public API remains synchronous to match existing call-site
 * expectations. Full Effect conversion is deferred to PAN-447.
 */

import { getDatabase } from './index.js';
import type { SqliteDatabase } from './driver.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  issueId: string;
  role: string;
  status: string;
  workspace: string;
  harness: string | null;
  model: string | null;
  branch: string | null;
  sessionId: string | null;
  startedAt: string | null;
  lastActivity: string | null;
  lastResumeAt: string | null;
  stoppedAt: string | null;
  stoppedByUser: boolean | null;
  stoppedByPause: boolean | null;
  kickoffDelivered: boolean | null;
  hostOverride: boolean | null;
  costSoFar: number | null;
  phase: string | null;
  workType: string | null;
  paused: boolean | null;
  pausedReason: string | null;
  pausedAt: string | null;
  troubled: boolean | null;
  troubledAt: string | null;
  consecutiveFailures: number | null;
  firstFailureInRunAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  lastFailureNextRetryAt: string | null;
  flywheelRunId: string | null;
  roleRunHead: string | null;
  reviewSubRole: string | null;
  reviewRunId: string | null;
  reviewSynthesisAgentId: string | null;
  reviewOutputPath: string | null;
  reviewDeadlineAt: string | null;
  reviewMonitorSignaled: string | null;
  reviewRetryAttempt: number | null;
  inspectSubRole: string | null;
  deliveryMethod: string | null;
  supervisorEnabled: boolean | null;
  channelsEnabled: boolean | null;
  updatedAt: string;
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

export function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row['id'] as string,
    issueId: row['issue_id'] as string,
    role: row['role'] as string,
    status: row['status'] as string,
    workspace: row['workspace'] as string,
    harness: (row['harness'] as string | null) ?? null,
    model: (row['model'] as string | null) ?? null,
    branch: (row['branch'] as string | null) ?? null,
    sessionId: (row['session_id'] as string | null) ?? null,
    startedAt: (row['started_at'] as string | null) ?? null,
    lastActivity: (row['last_activity'] as string | null) ?? null,
    lastResumeAt: (row['last_resume_at'] as string | null) ?? null,
    stoppedAt: (row['stopped_at'] as string | null) ?? null,
    stoppedByUser: row['stopped_by_user'] == null ? null : Boolean(row['stopped_by_user']),
    stoppedByPause: row['stopped_by_pause'] == null ? null : Boolean(row['stopped_by_pause']),
    kickoffDelivered: row['kickoff_delivered'] == null ? null : Boolean(row['kickoff_delivered']),
    hostOverride: row['host_override'] == null ? null : Boolean(row['host_override']),
    costSoFar: (row['cost_so_far'] as number | null) ?? null,
    phase: (row['phase'] as string | null) ?? null,
    workType: (row['work_type'] as string | null) ?? null,
    paused: row['paused'] == null ? null : Boolean(row['paused']),
    pausedReason: (row['paused_reason'] as string | null) ?? null,
    pausedAt: (row['paused_at'] as string | null) ?? null,
    troubled: row['troubled'] == null ? null : Boolean(row['troubled']),
    troubledAt: (row['troubled_at'] as string | null) ?? null,
    consecutiveFailures: (row['consecutive_failures'] as number | null) ?? null,
    firstFailureInRunAt: (row['first_failure_in_run_at'] as string | null) ?? null,
    lastFailureAt: (row['last_failure_at'] as string | null) ?? null,
    lastFailureReason: (row['last_failure_reason'] as string | null) ?? null,
    lastFailureNextRetryAt: (row['last_failure_next_retry_at'] as string | null) ?? null,
    flywheelRunId: (row['flywheel_run_id'] as string | null) ?? null,
    roleRunHead: (row['role_run_head'] as string | null) ?? null,
    reviewSubRole: (row['review_sub_role'] as string | null) ?? null,
    reviewRunId: (row['review_run_id'] as string | null) ?? null,
    reviewSynthesisAgentId: (row['review_synthesis_agent_id'] as string | null) ?? null,
    reviewOutputPath: (row['review_output_path'] as string | null) ?? null,
    reviewDeadlineAt: (row['review_deadline_at'] as string | null) ?? null,
    reviewMonitorSignaled: (row['review_monitor_signaled'] as string | null) ?? null,
    reviewRetryAttempt: (row['review_retry_attempt'] as number | null) ?? null,
    inspectSubRole: (row['inspect_sub_role'] as string | null) ?? null,
    deliveryMethod: (row['delivery_method'] as string | null) ?? null,
    supervisorEnabled: row['supervisor_enabled'] == null ? null : Boolean(row['supervisor_enabled']),
    channelsEnabled: row['channels_enabled'] == null ? null : Boolean(row['channels_enabled']),
    updatedAt: row['updated_at'] as string,
  };
}

const ALL_COLUMNS = [
  'id', 'issue_id', 'role', 'status', 'workspace',
  'harness', 'model', 'branch', 'session_id',
  'started_at', 'last_activity', 'last_resume_at', 'stopped_at',
  'stopped_by_user', 'stopped_by_pause', 'kickoff_delivered', 'host_override',
  'cost_so_far', 'phase', 'work_type',
  'paused', 'paused_reason', 'paused_at',
  'troubled', 'troubled_at', 'consecutive_failures',
  'first_failure_in_run_at', 'last_failure_at', 'last_failure_reason', 'last_failure_next_retry_at',
  'flywheel_run_id', 'role_run_head',
  'review_sub_role', 'review_run_id', 'review_synthesis_agent_id',
  'review_output_path', 'review_deadline_at', 'review_monitor_signaled', 'review_retry_attempt',
  'inspect_sub_role',
  'delivery_method', 'supervisor_enabled', 'channels_enabled', 'updated_at',
];

const SELECT_SQL = `SELECT ${ALL_COLUMNS.join(', ')} FROM agents`;

function agentToParams(agent: Agent): unknown[] {
  return [
    agent.id,
    agent.issueId,
    agent.role,
    agent.status,
    agent.workspace,
    agent.harness,
    agent.model,
    agent.branch,
    agent.sessionId,
    agent.startedAt,
    agent.lastActivity,
    agent.lastResumeAt,
    agent.stoppedAt,
    agent.stoppedByUser == null ? null : (agent.stoppedByUser ? 1 : 0),
    agent.stoppedByPause == null ? null : (agent.stoppedByPause ? 1 : 0),
    agent.kickoffDelivered == null ? null : (agent.kickoffDelivered ? 1 : 0),
    agent.hostOverride == null ? null : (agent.hostOverride ? 1 : 0),
    agent.costSoFar,
    agent.phase,
    agent.workType,
    agent.paused == null ? null : (agent.paused ? 1 : 0),
    agent.pausedReason,
    agent.pausedAt,
    agent.troubled == null ? null : (agent.troubled ? 1 : 0),
    agent.troubledAt,
    agent.consecutiveFailures,
    agent.firstFailureInRunAt,
    agent.lastFailureAt,
    agent.lastFailureReason,
    agent.lastFailureNextRetryAt,
    agent.flywheelRunId,
    agent.roleRunHead,
    agent.reviewSubRole,
    agent.reviewRunId,
    agent.reviewSynthesisAgentId,
    agent.reviewOutputPath,
    agent.reviewDeadlineAt,
    agent.reviewMonitorSignaled,
    agent.reviewRetryAttempt,
    agent.inspectSubRole,
    agent.deliveryMethod,
    agent.supervisorEnabled == null ? null : (agent.supervisorEnabled ? 1 : 0),
    agent.channelsEnabled == null ? null : (agent.channelsEnabled ? 1 : 0),
    agent.updatedAt,
  ];
}

// ─── Read operations ──────────────────────────────────────────────────────────

export function getAgent(id: string): Agent | null {
  return getAgentWithDb(getDatabase(), id);
}

export function getAgentWithDb(db: Pick<SqliteDatabase, 'prepare'>, id: string): Agent | null {
  const row = db
    .prepare(`${SELECT_SQL} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export function listAgentsByStatusRole(status: string, role: string): Agent[] {
  const db = getDatabase();
  const rows = db
    .prepare(`${SELECT_SQL} WHERE status = ? AND role = ?`)
    .all(status, role) as Record<string, unknown>[];
  return rows.map(rowToAgent);
}

export function countAgentsByRole(): Record<string, number> {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT role, COUNT(*) AS n FROM agents GROUP BY role`)
    .all() as Array<{ role: string; n: number }>;
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.role] = row.n;
  }
  return result;
}

export function countAgentsByStatus(status: string): Record<string, number> {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT role, COUNT(*) AS n FROM agents WHERE status = ? GROUP BY role`)
    .all(status) as Array<{ role: string; n: number }>;
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.role] = row.n;
  }
  return result;
}

export function listAllAgents(): Agent[] {
  const db = getDatabase();
  const rows = db.prepare(SELECT_SQL).all() as Record<string, unknown>[];
  return rows.map(rowToAgent);
}

// ─── Write operations ─────────────────────────────────────────────────────────

export function upsertAgent(agent: Agent): Agent {
  return upsertAgentWithDb(getDatabase(), agent);
}

export function upsertAgentWithDb(db: Pick<SqliteDatabase, 'prepare'>, agent: Agent): Agent {
  const columns = ALL_COLUMNS.join(', ');
  const placeholders = ALL_COLUMNS.map(() => '?').join(', ');
  db.prepare(
    `INSERT OR REPLACE INTO agents (${columns}) VALUES (${placeholders})`,
  ).run(...agentToParams(agent));
  return getAgentWithDb(db, agent.id) ?? agent;
}

export function deleteAgent(id: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
}
