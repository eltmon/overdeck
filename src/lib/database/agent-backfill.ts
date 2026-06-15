/**
 * One-time versioned backfill for the PAN-1908 agents table.
 *
 * This is the ONLY module permitted to enumerate
 * `${PANOPTICON_HOME}/agents/{id}/state.json`. It is invoked:
 *
 *   - automatically once during the v54 -> v55 schema migration, and
 *   - manually via `pan admin db rebuild-agents`.
 *
 * Keeping the enumeration here makes it easy to audit that no hot path
 * (dashboard handlers, deacon patrol, read model) reads agent state from the
 * filesystem.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { getPanopticonHome } from '../paths.js';
import type { SqliteDatabase } from './driver.js';
import { agentStateToDbAgent } from './agent-mappers.js';
import type { AgentState } from '../agents.js';
import type { Agent as DbAgent } from './agents-db.js';

const VALID_ROLES = new Set<AgentState['role']>([
  'plan',
  'work',
  'review',
  'test',
  'ship',
  'flywheel',
  'strike',
]);

const COLUMN_MAP: Record<keyof DbAgent, string> = {
  id: 'id',
  issueId: 'issue_id',
  role: 'role',
  status: 'status',
  workspace: 'workspace',
  harness: 'harness',
  model: 'model',
  branch: 'branch',
  sessionId: 'session_id',
  startedAt: 'started_at',
  lastActivity: 'last_activity',
  lastResumeAt: 'last_resume_at',
  stoppedAt: 'stopped_at',
  stoppedByUser: 'stopped_by_user',
  stoppedByPause: 'stopped_by_pause',
  kickoffDelivered: 'kickoff_delivered',
  hostOverride: 'host_override',
  costSoFar: 'cost_so_far',
  phase: 'phase',
  workType: 'work_type',
  paused: 'paused',
  pausedReason: 'paused_reason',
  pausedAt: 'paused_at',
  troubled: 'troubled',
  troubledAt: 'troubled_at',
  consecutiveFailures: 'consecutive_failures',
  firstFailureInRunAt: 'first_failure_in_run_at',
  lastFailureAt: 'last_failure_at',
  lastFailureReason: 'last_failure_reason',
  lastFailureNextRetryAt: 'last_failure_next_retry_at',
  flywheelRunId: 'flywheel_run_id',
  roleRunHead: 'role_run_head',
  reviewSubRole: 'review_sub_role',
  reviewRunId: 'review_run_id',
  reviewSynthesisAgentId: 'review_synthesis_agent_id',
  reviewOutputPath: 'review_output_path',
  reviewDeadlineAt: 'review_deadline_at',
  reviewMonitorSignaled: 'review_monitor_signaled',
  reviewRetryAttempt: 'review_retry_attempt',
  inspectSubRole: 'inspect_sub_role',
  deliveryMethod: 'delivery_method',
  supervisorEnabled: 'supervisor_enabled',
  channelsEnabled: 'channels_enabled',
  updatedAt: 'updated_at',
};

function getAgentDir(agentId: string): string {
  return join(getPanopticonHome(), 'agents', agentId);
}

function getManagedTmuxSocketName(): string {
  return process.env.PANOPTICON_TMUX_SOCKET_NAME ?? 'panopticon';
}

function listLiveTmuxSessionNames(): Set<string> {
  try {
    const output = execFileSync(
      'tmux',
      ['-L', getManagedTmuxSocketName(), 'list-sessions', '-F', '#{session_name}'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return new Set(
      output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    // tmux not running or unavailable — treat every agent as not live
    return new Set();
  }
}

function parseAgentStateJson(content: string, fallbackId: string): AgentState | null {
  let parsed: Partial<AgentState>;
  try {
    parsed = JSON.parse(content) as Partial<AgentState>;
  } catch {
    return null;
  }

  if (!parsed.role || !VALID_ROLES.has(parsed.role)) {
    return null;
  }

  if (!parsed.id) {
    parsed.id = fallbackId;
  }

  if (!parsed.status) {
    parsed.status = 'stopped';
  }

  // Type cast is safe: we validated role and ensured id/status are strings.
  return parsed as AgentState;
}

function buildNamedParams(row: DbAgent): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    params[column] = (row as unknown as Record<string, unknown>)[key];
  }
  return params;
}

export interface BackfillAgentsOptions {
  verbose?: boolean;
  /**
   * Override tmux session discovery. Defaults to the real socket query.
   * Useful for tests and for environments where tmux is unavailable.
   */
  listLiveSessions?: () => Set<string>;
}

export interface BackfillAgentsResult {
  processed: number;
  skipped: number;
  markedStopped: number;
}

/**
 * Enumerate agent state files and upsert them into the agents table.
 *
 * Idempotent by id — re-running creates no duplicates. Status is reconciled
 * against live tmux sessions: an agent whose state says running/starting but
 * has no live session is marked stopped.
 */
export function backfillAgentsFromStateJsonSync(
  db: SqliteDatabase,
  options?: BackfillAgentsOptions,
): BackfillAgentsResult {
  const agentsDir = join(getPanopticonHome(), 'agents');
  const liveSessions = options?.listLiveSessions?.() ?? listLiveTmuxSessionNames();
  let processed = 0;
  let skipped = 0;
  let markedStopped = 0;

  let entries: string[] = [];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    return { processed, skipped, markedStopped };
  }

  const columns = Object.values(COLUMN_MAP);
  const placeholders = columns.map((col) => `$${col}`).join(', ');
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO agents (${columns.join(', ')}) VALUES (${placeholders})`,
  );

  const tx = db.transaction(() => {
    for (const entry of entries) {
      const dirPath = join(agentsDir, entry);
      let statePath: string;
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        statePath = join(dirPath, 'state.json');
      } catch {
        continue;
      }

      let content: string;
      try {
        content = readFileSync(statePath, 'utf-8');
      } catch {
        skipped++;
        continue;
      }

      const state = parseAgentStateJson(content, entry);
      if (!state) {
        skipped++;
        continue;
      }

      const reconciled = reconcileAgentStatus(state, liveSessions);
      if (reconciled.status === 'stopped' && state.status !== 'stopped') {
        markedStopped++;
      }

      const row = agentStateToDbAgent(reconciled);
      upsert.run(buildNamedParams(row));
      processed++;

      if (options?.verbose) {
        console.log(`[backfill] ${row.id} -> ${row.status}`);
      }
    }
  });

  tx();

  return { processed, skipped, markedStopped };
}

function reconcileAgentStatus(
  state: AgentState,
  liveSessions: Set<string>,
): AgentState {
  if ((state.status === 'running' || state.status === 'starting') && !liveSessions.has(state.id)) {
    return {
      ...state,
      status: 'stopped',
      stoppedAt: state.stoppedAt ?? new Date().toISOString(),
    };
  }
  return state;
}
