/**
 * Deferred planning hand-off (PAN-4155).
 *
 * When planning finalizes with auto-start, `completePlanningAutoSpawn` POSTs
 * `/api/agents` once. A spawn guardrail can refuse that request: the agent
 * ceiling, leaked specialists, critical RAM, or a stale health snapshot. The
 * operator's auto-start consent is still `granted` then, because the refusal
 * comes before the consent is claimed. Before this module nothing retried, and
 * the issue sat planned with no work agent until someone ran `pan start`.
 *
 * Now the refusal is journaled as `handoff.deferred`, and deacon-lite's
 * `retryDeferredHandoffs` re-sends the spawn on a backoff with NO guardrail
 * acknowledgement at all, so a machine never waives a health warning on a
 * retry. When the warnings clear the spawn goes through and spends the consent
 * as usual. After `DEFERRED_HANDOFF_WINDOW_MS` it gives up, records
 * `planning.failed stage=auto-handoff`, and warns in activity.
 *
 * The schedule lives in the pipeline journal, never in memory, so a dashboard
 * or deacon restart resumes it where it stood.
 */
import { existsSync } from 'node:fs';

import type { DomainEvent } from '@overdeck/contracts';

import { emitActivityEntry } from '../activity-logger.js';
import { getAgentState } from '../agents/agent-state-read.js';
import { readAutoSpawnOnFinalizeFlagAsync } from '../planning/auto-spawn-consent.js';
import { liveAgentInventory } from '../terminal-backends/inventory.js';
import { listWorkspaces } from '../workspaces/resolver.js';
import { getCloisterEventStore } from './event-store-provider.js';
import { appendPipelineEntry, lastPipelineEntry, type PipelineJournalEntry } from './pipeline-journal.js';
import { spawnWorkAgentThroughAgentsEndpoint, type SpawnWorkAgentResult } from './work-agent-start.js';

/** How long after the first refusal the retries keep going. */
export const DEFERRED_HANDOFF_WINDOW_MS = 2 * 60 * 60_000;
const DEFERRED_HANDOFF_BASE_DELAY_MS = 2 * 60_000;
const DEFERRED_HANDOFF_MAX_DELAY_MS = 20 * 60_000;

/** The delay before retry number `attempt + 1`: 2, 4, 8, 16, then every 20 minutes. */
export function deferredHandoffDelayMs(attempt: number): number {
  return Math.min(DEFERRED_HANDOFF_BASE_DELAY_MS * 2 ** Math.max(0, attempt), DEFERRED_HANDOFF_MAX_DELAY_MS);
}

/** The schedule each `handoff.deferred` / `handoff.retried` entry carries. */
interface DeferredHandoffSchedule {
  deferredAt: string;
  attempt: number;
  nextRetryAt: string;
}

/**
 * Journal a guardrail-refused planning hand-off. Written by complete-planning
 * at the moment of the refusal; deacon-lite picks it up from there.
 */
export function recordHandoffDeferred(options: {
  workspacePath: string;
  issueId: string;
  error: string;
  httpStatus?: number;
  now?: number;
}): PipelineJournalEntry {
  const now = options.now ?? Date.now();
  const schedule: DeferredHandoffSchedule = {
    deferredAt: new Date(now).toISOString(),
    attempt: 0,
    nextRetryAt: new Date(now + deferredHandoffDelayMs(0)).toISOString(),
  };
  return appendPipelineEntry(options.workspacePath, {
    type: 'handoff.deferred',
    issueId: options.issueId.toUpperCase(),
    source: 'complete-planning',
    data: {
      ...schedule,
      reason: 'guardrails',
      error: options.error,
      ...(options.httpStatus !== undefined ? { httpStatus: options.httpStatus } : {}),
    },
  });
}

function readSchedule(entry: PipelineJournalEntry): DeferredHandoffSchedule | null {
  const data = entry.data ?? {};
  const deferredAt = typeof data['deferredAt'] === 'string' ? data['deferredAt'] : entry.at;
  const attempt = typeof data['attempt'] === 'number' ? data['attempt'] : 0;
  const nextRetryAt = typeof data['nextRetryAt'] === 'string' ? data['nextRetryAt'] : null;
  if (Number.isNaN(Date.parse(deferredAt)) || !nextRetryAt || Number.isNaN(Date.parse(nextRetryAt))) return null;
  return { deferredAt, attempt, nextRetryAt };
}

/** Why the operator's own action makes the retry moot, or null when it may go ahead. */
function operatorStandDownReason(
  issueId: string,
  deferredAtMs: number,
  liveAgentIds: ReadonlySet<string>,
  readAgentState: typeof getAgentState,
): string | null {
  const issueLower = issueId.toLowerCase();
  const workAgentId = `agent-${issueLower}`;
  if (liveAgentIds.has(workAgentId)) return 'a work agent is already running';
  const after = (value: string | undefined): boolean => {
    const at = value ? Date.parse(value) : Number.NaN;
    return !Number.isNaN(at) && at > deferredAtMs;
  };
  const work = readAgentState(workAgentId);
  if (work) {
    if (work.paused === true) return 'the issue is paused';
    if (after(work.startedAt)) return 'the work agent was started after the deferral';
    if (after(work.stoppedAt)) return 'the work agent was stopped after the deferral';
  }
  // The status label is a spawn-time snapshot: since PAN-3917 complete-planning's
  // stop projection writes no state.json, so it never reads anything but
  // 'running' — only startedAt tells us whether this is a new cycle.
  const planning = readAgentState(`planning-${issueLower}`);
  if (planning && after(planning.startedAt)) {
    return 'planning was restarted after the deferral';
  }
  return null;
}

export interface RetryDeferredHandoffsDeps {
  listWorkspaces?: typeof listWorkspaces;
  liveAgentInventory?: typeof liveAgentInventory;
  getAgentState?: typeof getAgentState;
  readConsent?: (issueId: string) => Promise<boolean>;
  spawn?: (issueId: string) => Promise<SpawnWorkAgentResult>;
  emitActivity?: typeof emitActivityEntry;
}

const inFlight = new Set<string>();

function defaultSpawn(issueId: string): Promise<SpawnWorkAgentResult> {
  // No acknowledgement: `spawnWorkAgentThroughAgentsEndpoint` sends none, so
  // every guardrail warning still refuses the retry.
  return spawnWorkAgentThroughAgentsEndpoint(issueId, undefined, true, 'planning-auto-handoff');
}

/** Skip reasons that end the retries without calling it a failure: the operator or the tracker decided. */
const STAND_DOWN_SKIP_REASONS = new Set(['paused', 'troubled', 'closed-issue', 'already-running']);
/** Skip reasons no amount of waiting fixes. */
const GIVE_UP_SKIP_REASONS = new Set(['unauthorized']);

/**
 * One deacon-lite pass: for every workspace whose last `handoff.*` entry is a
 * pending deferral, re-send the refused spawn once its backoff has elapsed.
 */
export async function retryDeferredHandoffs(
  now = Date.now(),
  deps: RetryDeferredHandoffsDeps = {},
): Promise<string[]> {
  const actions: string[] = [];
  // An unreadable inventory is indeterminate: a work agent may be alive.
  const inventory = await (deps.liveAgentInventory ?? liveAgentInventory)();
  if (inventory === null) return actions;
  const liveAgentIds = new Set(inventory.panes.map((pane) => pane.agentId));

  let workspaces: ReturnType<typeof listWorkspaces>;
  try {
    workspaces = (deps.listWorkspaces ?? listWorkspaces)();
  } catch (err) {
    console.error('[deacon-lite] Could not list workspaces for deferred hand-off retries:', err);
    return actions;
  }

  const emitActivity = deps.emitActivity ?? emitActivityEntry;
  const readAgentState = deps.getAgentState ?? getAgentState;

  for (const workspace of workspaces) {
    const issueId = workspace.issueId?.toUpperCase();
    if (!issueId || !workspace.path || !existsSync(workspace.path)) continue;
    const last = lastPipelineEntry(workspace.path, 'handoff.');
    if (!last || (last.type !== 'handoff.deferred' && last.type !== 'handoff.retried')) continue;
    const schedule = readSchedule(last);
    if (!schedule) continue;
    if (inFlight.has(issueId)) continue;
    inFlight.add(issueId);
    try {
      const outcome = await retryOne({
        issueId, workspacePath: workspace.path, schedule, now, liveAgentIds, readAgentState, emitActivity, deps,
      });
      if (outcome) actions.push(`retryDeferredHandoffs: ${issueId} ${outcome}`);
    } catch (err) {
      console.error(`[deacon-lite] Deferred hand-off retry failed for ${issueId}:`, err);
    } finally {
      inFlight.delete(issueId);
    }
  }
  return actions;
}

async function retryOne(input: {
  issueId: string;
  workspacePath: string;
  schedule: DeferredHandoffSchedule;
  now: number;
  liveAgentIds: ReadonlySet<string>;
  readAgentState: typeof getAgentState;
  emitActivity: typeof emitActivityEntry;
  deps: RetryDeferredHandoffsDeps;
}): Promise<string | null> {
  const { issueId, workspacePath, schedule, now, emitActivity, deps } = input;
  const deferredAtMs = Date.parse(schedule.deferredAt);

  const standDown = operatorStandDownReason(issueId, deferredAtMs, input.liveAgentIds, input.readAgentState)
    ?? (await (deps.readConsent ?? readAutoSpawnOnFinalizeFlagAsync)(issueId).catch(() => false)
      ? null
      : 'auto-start consent is no longer granted');
  if (standDown) {
    standDownHandoff(workspacePath, issueId, schedule, standDown, emitActivity);
    return `stood down: ${standDown}`;
  }

  if (now - deferredAtMs >= DEFERRED_HANDOFF_WINDOW_MS) {
    giveUpHandoff(workspacePath, issueId, schedule, 'guardrails', 'spawn guardrails still refused the work agent', emitActivity);
    return `gave up after ${schedule.attempt} retries`;
  }
  if (now < Date.parse(schedule.nextRetryAt)) return null;

  const attempt = schedule.attempt + 1;
  let result: SpawnWorkAgentResult;
  try {
    result = await (deps.spawn ?? defaultSpawn)(issueId);
  } catch (err) {
    result = { spawned: false, skippedReason: 'unreachable', error: err instanceof Error ? err.message : String(err) };
  }

  if (result.spawned) {
    appendPipelineEntry(workspacePath, {
      type: 'handoff.started',
      issueId,
      source: 'deacon-lite',
      data: { deferredAt: schedule.deferredAt, attempt, agentId: result.agentId, ...(result.queued ? { queued: true } : {}) },
    });
    emitActivity({
      source: 'plan',
      level: 'info',
      message: `${issueId} work agent started on deferred retry ${attempt} after the spawn guardrails cleared`,
      issueId,
    });
    return `started the work agent on retry ${attempt}`;
  }

  const skipReason = result.skippedReason ?? 'spawn-failed';
  const error = result.error ?? `Work agent startup failed: ${skipReason}`;
  if (STAND_DOWN_SKIP_REASONS.has(skipReason)) {
    standDownHandoff(workspacePath, issueId, schedule, `the spawn was refused as ${skipReason}: ${error}`, emitActivity);
    return `stood down: ${skipReason}`;
  }
  if (GIVE_UP_SKIP_REASONS.has(skipReason)) {
    giveUpHandoff(workspacePath, issueId, { ...schedule, attempt }, skipReason, error, emitActivity);
    return `gave up: ${skipReason}`;
  }

  appendPipelineEntry(workspacePath, {
    type: 'handoff.retried',
    issueId,
    source: 'deacon-lite',
    data: {
      deferredAt: schedule.deferredAt,
      attempt,
      nextRetryAt: new Date(now + deferredHandoffDelayMs(attempt)).toISOString(),
      skipReason,
      error,
    },
  });
  return `retry ${attempt} refused (${skipReason})`;
}

function standDownHandoff(
  workspacePath: string,
  issueId: string,
  schedule: DeferredHandoffSchedule,
  reason: string,
  emitActivity: typeof emitActivityEntry,
): void {
  appendPipelineEntry(workspacePath, {
    type: 'handoff.abandoned',
    issueId,
    source: 'deacon-lite',
    data: { deferredAt: schedule.deferredAt, attempt: schedule.attempt, outcome: 'stood-down', reason },
  });
  emitActivity({
    source: 'plan',
    level: 'info',
    message: `${issueId} deferred work-agent start no longer retried: ${reason}`,
    issueId,
  });
}

function giveUpHandoff(
  workspacePath: string,
  issueId: string,
  schedule: DeferredHandoffSchedule,
  skipReason: string,
  error: string,
  emitActivity: typeof emitActivityEntry,
): void {
  appendPipelineEntry(workspacePath, {
    type: 'handoff.abandoned',
    issueId,
    source: 'deacon-lite',
    data: { deferredAt: schedule.deferredAt, attempt: schedule.attempt, outcome: 'gave-up', skipReason, error },
  });
  const details = { workAgentSkipReason: skipReason, workAgentError: error, attempts: schedule.attempt };
  console.warn(`[deacon-lite] ${issueId} deferred auto-handoff gave up after ${schedule.attempt} retries (${skipReason}): ${error}`);
  try {
    getCloisterEventStore()?.append({
      type: 'planning.failed',
      timestamp: new Date().toISOString(),
      payload: { issueId, error, stage: 'auto-handoff', ...details },
    } as unknown as Omit<DomainEvent, 'sequence'>);
  } catch (err) {
    console.warn(`[deacon-lite] Could not record planning.failed for ${issueId}:`, err);
  }
  emitActivity({
    source: 'plan',
    level: 'warn',
    message: `${issueId} planning complete, but the work agent never started: ${error}. Run pan start ${issueId} once resources allow.`,
    issueId,
    details: JSON.stringify(details),
  });
}
