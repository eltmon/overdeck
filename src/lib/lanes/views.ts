/**
 * Lane views: the derived read model behind `GET /api/lanes` and `pan lane list`
 * (.pan/drafts/pan-4223.md WI-5 step 1, D10, NFR-1, NFR-3).
 *
 * Rows come from `listLaneConversations`, which includes archived lanes: reap
 * archives by default (D14, FR-24), and the enriched conversation list drops
 * archived rows, so it cannot be the row source. Liveness fields are joined
 * from the enriched list by name. Nothing here is stored: activity (D10),
 * the newest report, the iteration (D7) and git facts are computed per read,
 * then memoized per filter for 3 s.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { latestWorkerReport, type WorkerReport, type WorkerReportStatus } from '../agents/worker/report.js';
import { withConcurrencyLimit } from '../concurrency.js';
import { getEnrichedConversationList } from '../overdeck/conversation-list.js';
import { listLaneConversations, type LaneRole, type LegacyConversation } from '../overdeck/conversations.js';
import { laneIterations } from './iteration.js';
import { judgedIteration, pairBuilder, type CriticSummary, type PairingRow, type VerdictState } from './pairing.js';

const execFileAsync = promisify(execFile);

const MEMO_TTL_MS = 3_000;
/** D10 `starting`: not alive, not ended, created less than this long ago. */
const STARTING_GRACE_MS = 3 * 60_000;
const GIT_TIMEOUT_MS = 10_000;
const GIT_CONCURRENCY = 8;
const GIT_BACKED_ROLES: ReadonlySet<LaneRole> = new Set(['builder', 'critic', 'verifier', 'orchestrator']);

export type LaneActivity = 'failed-to-start' | 'needs-you' | 'working' | 'idle' | 'starting' | 'stopped';

export interface LaneGitFacts {
  branch: string | null;
  head: string | null;
  ahead: number | null;
  dirty: boolean;
}

export interface LaneView {
  id: number;
  name: string;
  title: string | null;
  run: string;
  key: string;
  role: LaneRole;
  iteration: number;
  parentId: number | null;
  parentName: string | null;
  harness: string | null;
  model: string | null;
  effort: string | null;
  projectKey: string | null;
  cwd: string;
  activity: LaneActivity;
  report: { seq: number; at: string; status: WorkerReportStatus; head: string | null; branch: string | null } | null;
  git: LaneGitFacts | null;
  costUsd: number | null;
  createdAt: string;
  lastActivityAt: string | null;
  archived: boolean;
  /** Critic and verifier lanes with a link: the builder row judged (WI-20). */
  criticOf: { id: number; name: string; key: string; iteration: number } | null;
  /** Critic and verifier lanes only. */
  verdict: { value: VerdictState; defects: number | null; file: string | null } | null;
  /** Builder lanes only; [] otherwise. */
  critics: CriticSummary[];
  latestVerdict: CriticSummary | null;
  answering: CriticSummary | null;
}

export interface LaneViewFilter {
  run?: string;
  parentName?: string;
  key?: string;
  role?: LaneRole;
}

/** The liveness fields the enriched conversation list carries per row. */
interface EnrichedLiveness {
  name: string;
  sessionAlive?: boolean;
  isWorking?: boolean;
  pendingInputCount?: number;
  lastActivityAt?: string | null;
  totalCost?: number;
}

/** Test seams; production callers use the defaults. */
export interface LaneViewDeps {
  enrichedList?: () => Promise<readonly unknown[]>;
  latestReport?: (id: string) => Promise<WorkerReport | null>;
  gitFacts?: (cwd: string) => Promise<LaneGitFacts | null>;
  now?: () => number;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
  return stdout.trim();
}

/** NFR-3: branch, head, ahead of upstream and dirtiness; null when the directory is not a readable git worktree. */
export async function readLaneGitFacts(cwd: string): Promise<LaneGitFacts | null> {
  let head: string;
  try {
    head = await git(cwd, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).then((name) => (name === 'HEAD' ? null : name), () => null);
  const ahead = await git(cwd, ['rev-list', '--count', '@{u}..HEAD']).then((count) => Number(count), () => null);
  const dirty = await git(cwd, ['status', '--porcelain']).then((status) => status.length > 0, () => false);
  return { branch, head, ahead: Number.isFinite(ahead) ? ahead : null, dirty };
}

/** D10, first match wins. */
function activityOf(row: LegacyConversation, live: EnrichedLiveness | undefined, now: number): LaneActivity {
  if (row.archivedAt !== null) return 'stopped';
  if (row.spawnError) return 'failed-to-start';
  if (live?.sessionAlive) {
    if ((live.pendingInputCount ?? 0) > 0) return 'needs-you';
    if (live.isWorking) return 'working';
    return 'idle';
  }
  if (row.status === 'active' && now - Date.parse(row.createdAt) < STARTING_GRACE_MS) return 'starting';
  return 'stopped';
}

/**
 * Every lane of each (run, key) the rows belong to, archived included: D7
 * counts over the whole group, and a critic pairs with a builder another
 * conversation may have launched (WI-20).
 */
function laneGroupsOf(rows: readonly LegacyConversation[]): LegacyConversation[] {
  const groups = new Map<string, { run: string; key: string }>();
  for (const row of rows) {
    if (row.gauntletRun && row.laneKey) groups.set(`${row.gauntletRun}\u0000${row.laneKey}`, { run: row.gauntletRun, key: row.laneKey });
  }
  const seen = new Set<number>();
  const context: LegacyConversation[] = [];
  for (const group of groups.values()) {
    for (const row of listLaneConversations(group)) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        context.push(row);
      }
    }
  }
  return context;
}

async function buildLaneViews(filter: LaneViewFilter, deps: LaneViewDeps, now: number): Promise<LaneView[]> {
  const rows = listLaneConversations(filter);
  if (rows.length === 0) return [];
  const enriched = await (deps.enrichedList ?? (() => getEnrichedConversationList(500, 0)))();
  const liveness = new Map<string, EnrichedLiveness>();
  for (const entry of enriched as EnrichedLiveness[]) liveness.set(entry.name, entry);
  const context = laneGroupsOf(rows);
  const iterations = laneIterations(context);
  const latestReport = deps.latestReport ?? latestWorkerReport;
  const gitFacts = deps.gitFacts ?? readLaneGitFacts;
  const reports = new Map<string, WorkerReport | null>();
  await withConcurrencyLimit(context.map((row) => async () => {
    reports.set(row.name, await latestReport(`conv-${row.name}`));
  }), GIT_CONCURRENCY);
  const pairingRows = context.map((row): PairingRow => {
    const report = reports.get(row.name) ?? null;
    return {
      id: row.id,
      name: row.name,
      run: row.gauntletRun ?? '',
      key: row.laneKey ?? '',
      role: row.laneRole ?? 'builder',
      iteration: iterations.get(row.name) ?? 1,
      createdAt: row.createdAt,
      criticOfId: row.criticOfConversationId,
      activity: activityOf(row, row.archivedAt === null ? liveness.get(row.name) : undefined, now),
      report: report ? { status: report.status, ...(report.verdict ? { verdict: report.verdict } : {}) } : null,
    };
  });
  const pairingById = new Map(pairingRows.map((row) => [row.id, row]));

  return withConcurrencyLimit(rows.map((row) => async (): Promise<LaneView> => {
    const archived = row.archivedAt !== null;
    const live = archived ? undefined : liveness.get(row.name);
    const role = row.laneRole as LaneRole;
    const report = reports.get(row.name) ?? null;
    const git = !archived && GIT_BACKED_ROLES.has(role) ? await gitFacts(row.cwd) : null;
    const pairing = pairingById.get(row.id);
    const judge = role === 'critic' || role === 'verifier';
    const judged = judge && pairing ? pairingById.get(pairing.criticOfId ?? -1) : undefined;
    const judgedAt = judge && pairing ? judgedIteration(pairing, pairingById) : null;
    const verdict = report?.status === 'done' ? report.verdict : undefined;
    const builderPairing = role === 'builder' && pairing ? pairBuilder(pairing, pairingRows) : null;
    return {
      id: row.id,
      name: row.name,
      title: row.title,
      run: row.gauntletRun ?? '',
      key: row.laneKey ?? '',
      role,
      iteration: iterations.get(row.name) ?? 1,
      parentId: row.parentConversationId,
      parentName: row.parentConversationName,
      harness: row.harness,
      model: row.model,
      effort: row.effort,
      projectKey: row.projectKey,
      cwd: row.cwd,
      activity: activityOf(row, live, now),
      report: report
        ? { seq: report.seq, at: report.at, status: report.status, head: report.git?.head ?? null, branch: report.git?.branch ?? null }
        : null,
      git,
      costUsd: live?.totalCost ?? row.totalCost ?? null,
      createdAt: row.createdAt,
      lastActivityAt: live?.lastActivityAt ?? null,
      archived,
      criticOf: judged && judgedAt !== null ? { id: judged.id, name: judged.name, key: judged.key, iteration: judgedAt } : null,
      verdict: judge ? { value: verdict?.value ?? 'pending', defects: verdict?.defects ?? null, file: verdict?.file ?? null } : null,
      critics: builderPairing?.critics ?? [],
      latestVerdict: builderPairing?.latestVerdict ?? null,
      answering: builderPairing?.answering ?? null,
    };
  }), GIT_CONCURRENCY);
}

const memo = new Map<string, { at: number; promise: Promise<LaneView[]> }>();

/** Drops every memoized view list, e.g. after a launch or a reap. */
export function invalidateLaneViews(): void {
  memo.clear();
}

export function listLaneViews(filter: LaneViewFilter = {}, deps: LaneViewDeps = {}): Promise<LaneView[]> {
  const now = (deps.now ?? Date.now)();
  const key = JSON.stringify([filter.run ?? null, filter.parentName ?? null, filter.key ?? null, filter.role ?? null]);
  const hit = memo.get(key);
  if (hit && now - hit.at < MEMO_TTL_MS) return hit.promise;
  const entry = { at: now, promise: buildLaneViews(filter, deps, now) };
  memo.set(key, entry);
  entry.promise.catch(() => {
    if (memo.get(key) === entry) memo.delete(key);
  });
  return entry.promise;
}
