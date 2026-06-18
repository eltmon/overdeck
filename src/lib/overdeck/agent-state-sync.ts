import type { AgentState, Role } from '../agents.js';
import type { RuntimeName } from '../runtimes/types.js';
import { getOverdeckDatabaseSync } from './infra.js';

type OverdeckAgentRow = {
  id: string;
  issue_id: string;
  role: string;
  status: string;
  workspace: string;
  session_id: string | null;
  harness: string | null;
  model: string | null;
  host_override: string | null;
  delivery_method: string | null;
  started_at: number | null;
  last_resume_at: number | null;
  stopped_by_user: number | null;
  kickoff_delivered: number | null;
  paused: number | null;
  paused_reason: string | null;
  troubled: number | null;
  channels_enabled: number | null;
  consecutive_failures: number | null;
  first_failure_in_run_at: number | null;
  last_failure_next_retry_at: number | null;
  updated_at: number;
};

const AGENT_COLUMNS = [
  'id',
  'issue_id',
  'role',
  'status',
  'workspace',
  'session_id',
  'harness',
  'model',
  'host_override',
  'delivery_method',
  'started_at',
  'last_resume_at',
  'stopped_by_user',
  'kickoff_delivered',
  'paused',
  'paused_reason',
  'troubled',
  'channels_enabled',
  'consecutive_failures',
  'first_failure_in_run_at',
  'last_failure_next_retry_at',
  'updated_at',
] as const;

const SELECT_AGENT_SQL = `SELECT ${AGENT_COLUMNS.join(', ')} FROM agents`;

function isoFromMillis(value: number | null | undefined): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}

function millisFromIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function boolFromInteger(value: number | null | undefined): boolean | undefined {
  return value == null ? undefined : Boolean(value);
}

function hostOverrideFromRow(value: string | null | undefined): boolean | undefined {
  if (value == null) return undefined;
  return value === '1' || value === 'true' || value === 'yes';
}

function hostOverrideToRow(value: boolean | undefined): string | null {
  return value === true ? 'true' : null;
}

function overdeckRowToAgentState(row: OverdeckAgentRow): AgentState {
  const deliveryMethod = row.delivery_method as AgentState['deliveryMethod'] | null;
  return {
    id: row.id,
    issueId: row.issue_id,
    workspace: row.workspace,
    role: row.role as Role,
    model: row.model ?? '',
    status: row.status as AgentState['status'],
    startedAt: isoFromMillis(row.started_at) ?? isoFromMillis(row.updated_at) ?? new Date().toISOString(),
    harness: row.harness ? (row.harness as RuntimeName) : undefined,
    lastResumeAt: isoFromMillis(row.last_resume_at),
    stoppedByUser: boolFromInteger(row.stopped_by_user),
    kickoffDelivered: boolFromInteger(row.kickoff_delivered),
    paused: boolFromInteger(row.paused),
    pausedReason: row.paused_reason ?? undefined,
    troubled: boolFromInteger(row.troubled),
    consecutiveFailures: row.consecutive_failures ?? undefined,
    firstFailureInRunAt: isoFromMillis(row.first_failure_in_run_at),
    lastFailureNextRetryAt: isoFromMillis(row.last_failure_next_retry_at),
    sessionId: row.session_id ?? undefined,
    channelsEnabled: boolFromInteger(row.channels_enabled),
    supervisorEnabled: deliveryMethod === 'supervisor' ? true : undefined,
    deliveryMethod: deliveryMethod ?? undefined,
    hostOverride: hostOverrideFromRow(row.host_override),
  };
}

function stateToOverdeckParams(state: AgentState, updatedAt: number): unknown[] {
  const deliveryMethod = state.deliveryMethod ?? (state.supervisorEnabled === true ? 'supervisor' : null);
  return [
    state.id,
    state.issueId,
    state.role,
    state.status,
    state.workspace,
    state.sessionId ?? null,
    state.harness ?? '',
    state.model ?? '',
    hostOverrideToRow(state.hostOverride),
    deliveryMethod,
    millisFromIso(state.startedAt),
    millisFromIso(state.lastResumeAt),
    state.stoppedByUser == null ? null : (state.stoppedByUser ? 1 : 0),
    state.kickoffDelivered == null ? null : (state.kickoffDelivered ? 1 : 0),
    state.paused == null ? null : (state.paused ? 1 : 0),
    state.pausedReason ?? null,
    state.troubled == null ? null : (state.troubled ? 1 : 0),
    state.channelsEnabled == null ? null : (state.channelsEnabled ? 1 : 0),
    state.consecutiveFailures ?? null,
    millisFromIso(state.firstFailureInRunAt),
    millisFromIso(state.lastFailureNextRetryAt),
    updatedAt,
  ];
}

export function getOverdeckAgentStateSync(agentId: string): AgentState | null {
  const row = getOverdeckDatabaseSync()
    .prepare(`${SELECT_AGENT_SQL} WHERE id = ?`)
    .get(agentId) as OverdeckAgentRow | undefined;
  return row ? overdeckRowToAgentState(row) : null;
}

export function listOverdeckAgentStatesSync(): AgentState[] {
  const rows = getOverdeckDatabaseSync()
    .prepare(SELECT_AGENT_SQL)
    .all() as OverdeckAgentRow[];
  return rows.map(overdeckRowToAgentState);
}

export function saveOverdeckAgentStateSync(state: AgentState): void {
  const db = getOverdeckDatabaseSync();
  const updatedAt = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'working', ?)`,
  ).run(state.issueId, updatedAt);
  db.prepare(
    `INSERT OR REPLACE INTO agents (${AGENT_COLUMNS.join(', ')}) VALUES (${AGENT_COLUMNS.map(() => '?').join(', ')})`,
  ).run(...stateToOverdeckParams(state, updatedAt));
}
