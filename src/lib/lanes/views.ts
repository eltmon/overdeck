/**
 * Lane views: the derived read model behind `GET /api/lanes` and `pan lane list`
 * (.pan/drafts/pan-4223.md WI-5 step 1, D10, NFR-1, NFR-3).
 *
 * Rows come from `listAllLaneRows`, which includes archived lanes: reap
 * archives by default (D14, FR-24), and the enriched conversation list drops
 * archived rows, so it cannot be the row source. Liveness fields are joined
 * from the enriched list by name. Nothing here is stored: activity (D10),
 * the newest report, the iteration (D7) and git facts are computed per read,
 * then memoized per filter for 3 s.
 *
 * PAN-4638 WI-6: a lane on another machine comes from its stand-in. Its
 * activity, git facts, cost and last activity come from the follower's
 * mirror; nothing runs git or reads liveness here for it. Pairing keys on
 * names, so a remote critic pairs with a local builder and the reverse.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { LANE_STARTING_GRACE_MS, laneActivityOf, type LaneActivity } from '@overdeck/contracts';

import { latestWorkerReport, type WorkerReport, type WorkerReportStatus } from '../agents/worker/report.js';
import { withConcurrencyLimit } from '../concurrency.js';
import { getEnrichedConversationList } from '../overdeck/conversation-list.js';
import type { LaneRole } from '../overdeck/conversations.js';
import { laneIterations } from './iteration.js';
import { listAllLaneRows, type LaneRow } from './lane-rows.js';
import { judgedIteration, pairBuilder, type CriticSummary, type PairingRow, type VerdictState } from './pairing.js';
import type { LaneGitFacts } from './types.js';

const execFileAsync = promisify(execFile);

const MEMO_TTL_MS = 3_000;
const GIT_TIMEOUT_MS = 10_000;
const GIT_CONCURRENCY = 8;
const GIT_BACKED_ROLES: ReadonlySet<LaneRole> = new Set(['builder', 'critic', 'verifier', 'orchestrator']);

export type { LaneActivity };

export type { LaneGitFacts };

export interface LaneView {
  /** The local conversation id; null for a lane on another machine. */
  id: number | null;
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
  criticOf: { id: number | null; name: string; key: string; iteration: number } | null;
  /** Critic and verifier lanes only. */
  verdict: { value: VerdictState; defects: number | null; file: string | null } | null;
  /** Builder lanes only; [] otherwise. */
  critics: CriticSummary[];
  latestVerdict: CriticSummary | null;
  answering: CriticSummary | null;
  /** PAN-4638 FR-5: the machine a remote lane runs on; null for a lane on this machine. */
  machine: { environmentId: string; label: string; reachable: boolean; lastSeenAt: string | null } | null;
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

/**
 * Every lane of each (run, key) the rows belong to, archived included: D7
 * counts over the whole group, and a critic pairs with a builder another
 * conversation may have launched (WI-20).
 */
async function laneGroupsOf(rows: readonly LaneRow[]): Promise<LaneRow[]> {
  const groups = new Map<string, { run: string; key: string }>();
  for (const row of rows) groups.set(`${row.run}\u0000${row.key}`, { run: row.run, key: row.key });
  const seen = new Set<string>();
  const context: LaneRow[] = [];
  for (const group of groups.values()) {
    for (const row of await listAllLaneRows(group)) {
      if (!seen.has(row.name)) {
        seen.add(row.name);
        context.push(row);
      }
    }
  }
  return context;
}

/** WI-6 step 2: a remote lane's activity from its stand-in, never from this machine. */
function remoteActivity(row: LaneRow, now: number): LaneActivity {
  const mirror = row.remote?.mirror ?? null;
  if (row.archivedAt !== null) return 'stopped';
  if (mirror === null) return now - Date.parse(row.createdAt) < LANE_STARTING_GRACE_MS ? 'starting' : 'failed-to-start';
  return mirror.state === 'gone' ? 'stopped' : mirror.activity;
}

async function buildLaneViews(filter: LaneViewFilter, deps: LaneViewDeps, now: number): Promise<LaneView[]> {
  const rows = await listAllLaneRows(filter);
  if (rows.length === 0) return [];
  const enriched = await (deps.enrichedList ?? (() => getEnrichedConversationList(500, 0)))();
  const liveness = new Map<string, EnrichedLiveness>();
  for (const entry of enriched as EnrichedLiveness[]) liveness.set(entry.name, entry);
  const context = await laneGroupsOf(rows);
  const iterations = laneIterations(context);
  const latestReport = deps.latestReport ?? latestWorkerReport;
  const gitFacts = deps.gitFacts ?? readLaneGitFacts;
  const reports = new Map<string, WorkerReport | null>();
  await withConcurrencyLimit(context.map((row) => async () => {
    reports.set(row.name, await latestReport(`conv-${row.name}`));
  }), GIT_CONCURRENCY);
  const activityOf = (row: LaneRow): LaneActivity => {
    if (!row.local) return remoteActivity(row, now);
    return laneActivityOf({ ...row.local, ...(row.archivedAt === null ? liveness.get(row.name) : undefined) }, now);
  };
  const pairingRows = context.map((row): PairingRow => {
    const report = reports.get(row.name) ?? null;
    return {
      id: row.id,
      name: row.name,
      run: row.run,
      key: row.key,
      role: row.role,
      iteration: iterations.get(row.name) ?? 1,
      createdAt: row.createdAt,
      criticOfName: row.criticOfName,
      activity: activityOf(row),
      report: report ? { status: report.status, ...(report.verdict ? { verdict: report.verdict } : {}) } : null,
    };
  });
  const pairingByName = new Map(pairingRows.map((row) => [row.name, row]));

  return withConcurrencyLimit(rows.map((row) => async (): Promise<LaneView> => {
    const archived = row.archivedAt !== null;
    const { role, local, remote } = row;
    const live = archived || !local ? undefined : liveness.get(row.name);
    const mirror = remote?.mirror ?? null;
    const report = reports.get(row.name) ?? null;
    const git = remote ? (mirror?.git ?? null) : !archived && GIT_BACKED_ROLES.has(role) ? await gitFacts(row.cwd) : null;
    const pairing = pairingByName.get(row.name);
    const judge = role === 'critic' || role === 'verifier';
    const judged = judge && pairing?.criticOfName ? pairingByName.get(pairing.criticOfName) : undefined;
    const judgedAt = judge && pairing ? judgedIteration(pairing, pairingByName) : null;
    const verdict = report?.status === 'done' ? report.verdict : undefined;
    const builderPairing = role === 'builder' && pairing ? pairBuilder(pairing, pairingRows) : null;
    return {
      id: row.id,
      name: row.name,
      title: row.title,
      run: row.run,
      key: row.key,
      role,
      iteration: iterations.get(row.name) ?? 1,
      parentId: row.parentId,
      parentName: row.parentName,
      harness: row.harness,
      model: row.model,
      effort: row.effort,
      projectKey: row.projectKey,
      cwd: row.cwd,
      activity: activityOf(row),
      report: report
        ? { seq: report.seq, at: report.at, status: report.status, head: report.git?.head ?? null, branch: report.git?.branch ?? null }
        : null,
      git,
      costUsd: remote ? (mirror?.costUsd ?? null) : (live?.totalCost ?? local?.totalCost ?? null),
      createdAt: row.createdAt,
      lastActivityAt: remote ? (mirror?.lastActivityAt ?? null) : (live?.lastActivityAt ?? null),
      archived,
      criticOf: judged && judgedAt !== null ? { id: judged.id, name: judged.name, key: judged.key, iteration: judgedAt } : null,
      verdict: judge ? { value: verdict?.value ?? 'pending', defects: verdict?.defects ?? null, file: verdict?.file ?? null } : null,
      critics: builderPairing?.critics ?? [],
      latestVerdict: builderPairing?.latestVerdict ?? null,
      answering: builderPairing?.answering ?? null,
      machine: remote
        ? {
          environmentId: remote.facts.environmentId,
          label: remote.facts.label,
          reachable: mirror?.unreachableSince == null,
          lastSeenAt: mirror?.lastSeenAt ?? null,
        }
        : null,
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
