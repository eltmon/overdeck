/**
 * The merge-train board (PAN-4753 WI-7, FR-14..FR-16): one read that gives
 * the `MergeTrain` component everything it renders, per project, so the UI
 * stays a renderer. Served by `GET /api/merge-train/board`.
 *
 * Everything here is derived. The sources are the cached forge listings
 * (GitHub: one stale-while-revalidate listing per repo; GitLab: the cached
 * MR listing of every open and the newest merged MRs), the 60 s PR-facts
 * cache, the gate's cached approval answers, `pending_auto_merges` rows, the
 * in-memory merge runs,
 * the pipeline journal and the stored generations.
 *
 * Forge cost (NFR-6): a car candidate is picked without a forge read (a
 * decided review on the listing row, a cached gate answer for its head, an
 * auto-merge row or a merge run), and only candidates read PR facts, through
 * the cache the gate and the approval refresher already fill. Unresolved
 * threads are one GraphQL read per GitHub repo, cached two minutes. A
 * polyrepo project's listing is its writable member repos' listings, each
 * read with that repo's own forge (PAN-3657, WI-4).
 *
 * One project's failure never blanks the board (NFR-7): it returns that
 * project's card with `error` and empty lists.
 */
import { resolve } from 'node:path';

import type { ProjectConfig } from '../../../lib/projects.js';
import type { PrFacts } from '../../../lib/cloister/pr-facts.js';
import type { PipelineJournalEntry } from '../../../lib/cloister/pipeline-journal.js';
import type { PendingAutoMerge, UatGeneration } from '../../../lib/overdeck/merge-types.js';
import type { TrackerType } from '../../../lib/tracker/interface.js';
import type { MergeRun } from './merge-queue-service.js';
import type { UatGenerationPayload } from './uat-train.js';
import type { MergedPr } from './recent-merges.js';
import type {
  BatchWindowState,
  BoardProject,
  CarBlocker,
  CarState,
  MergeStepKey,
  MergeTrainBoard,
  StrikeState,
  TrainCar,
  TrainStrike,
} from './merge-train-board-types.js';
import { createSettledTtlPromiseCache } from '../../../lib/concurrency.js';
import { approvalProvenAtHead } from '../../../lib/cloister/approval-at-head.js';
import { autoMergeFromLabels } from '../../../lib/cloister/auto-merge-eligibility.js';
import { projectAutoMergeDefault, shouldHoldForUat } from '../../../lib/cloister/auto-merge-policy.js';
import { AUTO_MERGE_COOLDOWN_MS } from '../../../lib/cloister/auto-merge-config.js';
import { blockerReasonsFor } from '../../../lib/cloister/merge-blocker-types.js';
import { isHighPriorityMerge, mergeRouteFor } from '../../../lib/cloister/merge-route.js';
import { recentMergesForProject } from './recent-merges.js';

/** One open PR or MR on a `feature/<id>` or `strike/<id>` branch, normalized across forges. */
export interface OpenPr {
  issueId: string;
  kind: 'feature' | 'strike';
  branch: string;
  number: number;
  url: string | null;
  title: string | null;
  headSha: string | null;
  draft: boolean;
  /** The listing's own review decision (no marker approvals). */
  reviewDecided: boolean;
  /** Ready-since clock (D4): newest check completion on the head, ms. */
  readySince: number | null;
  /** GitLab: `detailed_merge_status === 'discussions_not_resolved'`. */
  discussionsOpen?: boolean;
  /** Polyrepo: the member repo this row came from, and its forge. */
  repoKey?: string;
  forge?: 'github' | 'gitlab';
}

export interface ProjectListing { open: OpenPr[]; merged: MergedPr[] }

export interface BoardDeps {
  listProjects(): Array<{ key: string; config: ProjectConfig }>;
  masterEnabled(): boolean;
  projectEnabled(config: ProjectConfig): boolean;
  requireUat(): boolean;
  forgeOf(projectPath: string): 'github' | 'gitlab';
  listing(projectPath: string, forge: 'github' | 'gitlab'): Promise<ProjectListing>;
  /** A polyrepo project's writable member repos (WI-4); none when omitted. */
  memberRepos?(projectPath: string, config: ProjectConfig): ReadonlyArray<{ repoKey: string; repoPath: string; forge: 'github' | 'gitlab' }>;
  unresolvedThreads(repoSlug: string, projectPath: string): Promise<ReadonlyMap<number, number>>;
  approvalAtHead(issueId: string, headSha: string | null): boolean | undefined;
  /** Feature facts (cached); with `strikeBranch`, the strike PR's facts. Null on failure. */
  facts(issueId: string, strikeBranch?: string, headSha?: string | null): Promise<PrFacts | null>;
  latestAutoMerge(issueId: string): PendingAutoMerge | null;
  /** Active and problem auto-merge rows of every project. */
  autoMergeRows(): PendingAutoMerge[];
  /** The scheduler's last pass: candidates it left unscheduled, with why (PAN-4772, PAN-5036). */
  notScheduled(): Array<{ issueId: string; projectKey: string; reason: string; scope?: 'project' }>;
  mergeRuns(): MergeRun[];
  issueLabels(issueId: string): readonly string[];
  issueTitle(issueId: string): string | null;
  projectKeyOfIssue(issueId: string): string | null;
  journal(issueId: string, branch: string): readonly PipelineJournalEntry[];
  generations(projectRoot: string): Promise<UatGenerationPayload[]>;
  promoted(projectRoot: string): UatGeneration[];
  droppedFromBatch(issueId: string, projectRoot: string): boolean;
  lacksBatchCi(projectRoot: string): boolean;
  trackerType(config: ProjectConfig): TrackerType | null;
  batchSize(): number;
  batchWaitMinutes(): number;
  now(): number;
}

const ROW_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const STEP_KEYS: readonly MergeStepKey[] = [
  'queued', 'validating-pr', 'preparing-work-agent', 'rebasing', 'stripping-planning',
  'verifying', 'reporting-statuses', 'squash-merging', 'post-merge-cleanup',
];
const LIVE_IN_BATCH = new Set(['assembling', 'ready']);
/** Flip when `POST /api/merge-train/policy/:issueId` (PAN-4753 WI-8) ships. */
const POLICY_WRITE_ROUTE_AVAILABLE = false;
const LIVE_BATCH = new Set(['assembling', 'ready', 'superseded']);
const CAR_ORDER: readonly CarState[] = ['merging', 'cooldown', 'ready', 'held', 'failed', 'blocked'];

function iso(msValue: number | null | undefined): string | null {
  return typeof msValue === 'number' && Number.isFinite(msValue) ? new Date(msValue).toISOString() : null;
}

function stepOf(run: MergeRun | undefined): MergeStepKey | null {
  return run?.step && (STEP_KEYS as readonly string[]).includes(run.step) ? run.step as MergeStepKey : null;
}

function runActive(run: MergeRun | undefined): boolean {
  return run?.phase === 'queued' || run?.phase === 'merging' || run?.phase === 'verifying';
}

/** Whether the row was judged at this head (a row without a head counts). */
function rowAtHead(row: PendingAutoMerge | null, head: string | null | undefined): boolean {
  return !!row && (!row.headSha || !head || row.headSha === head);
}

/** The journal's newest merge outcome is a failure newer than any later attempt. */
function journalFailure(entries: readonly PipelineJournalEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (entry.type === 'merge.attempted' || entry.type === 'merge.completed') return null;
    if (entry.type === 'merge.failed') {
      const reason = entry.data?.['reason'];
      return typeof reason === 'string' ? reason : 'the last merge failed';
    }
  }
  return null;
}

function lastVerdict(entries: readonly PipelineJournalEntry[], verdict?: string): PipelineJournalEntry | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (entry.type !== 'review.verdict') continue;
    if (!verdict || entry.data?.['verdict'] === verdict) return entry;
  }
  return null;
}

function stringField(entry: PipelineJournalEntry | null, key: string): string | null {
  const value = entry?.data?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function blockersOf(facts: PrFacts | null, unresolvedThreads: number): CarBlocker[] {
  if (!facts) return [];
  return blockerReasonsFor(facts, { unresolvedThreads }).map((reason) => {
    const failed = reason.type === 'failing_checks' ? (facts.checkFailures ?? []).map((check) => check.name) : [];
    return { ...reason, ...(failed.length > 0 ? { details: `failing: ${failed.join(', ')}` } : {}) };
  });
}

function projectIdentity(key: string, config: ProjectConfig, deps: BoardDeps, master: boolean) {
  const polyrepo = config.workspace?.type === 'polyrepo'
    ? (config.workspace.repos ?? []).map((repo) => repo.name)
    : null;
  let forge: 'github' | 'gitlab' | null = null;
  try {
    forge = polyrepo ? null : deps.forgeOf(resolve(config.path));
  } catch {
    forge = null;
  }
  const mode: 'auto' | 'hold' = shouldHoldForUat(undefined, projectAutoMergeDefault(config), deps.requireUat()) ? 'hold' : 'auto';
  return {
    projectKey: key,
    projectName: config.name ?? key,
    repo: config.github_repo ?? config.gitlab_repo ?? null,
    forge,
    polyrepo,
    enabled: master && deps.projectEnabled(config),
    override: config.merge_train ?? null,
    mode,
    cooldownMinutes: AUTO_MERGE_COOLDOWN_MS / 60_000,
  };
}

interface IssueRouting {
  heldForUat: boolean;
  route: 'auto-merge' | 'batch';
  policy: 'auto' | 'hold' | null;
}

function routingFor(issueId: string, branch: string, config: ProjectConfig, root: string, trainOn: boolean, deps: BoardDeps): IssueRouting {
  const labels = deps.issueLabels(issueId);
  const labelPolicy = autoMergeFromLabels(labels);
  const heldForUat = shouldHoldForUat(labelPolicy, projectAutoMergeDefault(config), deps.requireUat());
  const highPriority = isHighPriorityMerge({ branch, labels });
  const route = mergeRouteFor({
    heldForUat,
    trainOn,
    highPriority,
    droppedFromBatch: trainOn && !highPriority && !heldForUat && deps.droppedFromBatch(issueId, root),
  });
  return {
    heldForUat,
    route: route === 'per-pr' ? 'auto-merge' : 'batch',
    policy: labelPolicy === true ? 'auto' : labelPolicy === false ? 'hold' : null,
  };
}

async function boardProject(
  key: string,
  config: ProjectConfig,
  master: boolean,
  deps: BoardDeps,
): Promise<BoardProject> {
  const identity = projectIdentity(key, config, deps, master);
  const root = resolve(config.path);
  const trainOn = identity.enabled && !deps.lacksBatchCi(root);
  const forge = identity.forge;

  const listing: ProjectListing = identity.polyrepo ? await polyrepoListing(root, config, deps)
    : forge ? await deps.listing(root, forge) : { open: [], merged: [] };
  const threads = forge === 'github' && identity.repo
    ? await deps.unresolvedThreads(identity.repo, root).catch(() => new Map<number, number>())
    : new Map<number, number>();
  const batches = await deps.generations(root);
  const liveBatchOf = (issueId: string): { name: string; status: string } | null => {
    const gen = batches.find((batch) => LIVE_BATCH.has(batch.status)
      && batch.members.some((member) => member.issueId.toUpperCase() === issueId));
    return gen ? { name: gen.name, status: gen.status } : null;
  };

  const now = deps.now();
  const runs = new Map(deps.mergeRuns().map((run) => [run.issueId.toUpperCase(), run]));
  const openById = new Map(listing.open.filter((pr) => pr.kind === 'feature').map((pr) => [pr.issueId, pr]));
  const prLabel = (row: OpenPr) => `${row.repoKey ? `${row.repoKey} ` : ''}${(row.forge ?? forge) === 'gitlab' ? '!' : '#'}${row.number}`;

  // Candidates without a forge read (see the module doc).
  const candidates = new Set<string>();
  // `reviewDecision` is empty without branch protection and the gate caches
  // answers only for PRs it judged, so a journaled review verdict is the leg
  // that finds marker-approved PRs. Every feature row counts, not just the
  // one `openById` keeps per issue: a polyrepo issue's approved member PR
  // must find it even when another member's PR is undecided.
  for (const pr of listing.open) {
    if (pr.kind !== 'feature') continue;
    if (pr.reviewDecided || deps.approvalAtHead(pr.issueId, pr.headSha) !== undefined
      || deps.journal(pr.issueId, pr.branch).some((entry) => entry.type === 'review.verdict')) {
      candidates.add(pr.issueId);
    }
  }
  const skips = deps.notScheduled().filter((skip) => skip.projectKey === key);
  const skipReason = new Map(skips.filter((skip) => skip.scope !== 'project').map((skip) => [skip.issueId.toUpperCase(), skip.reason]));
  for (const id of skipReason.keys()) candidates.add(id);
  for (const row of deps.autoMergeRows()) {
    if (row.projectKey !== key || now - Date.parse(row.scheduledAt) > ROW_LOOKBACK_MS) continue;
    candidates.add(row.issueId.toUpperCase());
  }
  for (const id of runs.keys()) {
    if (deps.projectKeyOfIssue(id) === key) candidates.add(id);
  }

  // R9 plus WI-8: the labels are writable only on GitHub, and only once the
  // write route exists. Until PAN-4753 WI-8 ships, the toggle stays read-only.
  const policyWritable = POLICY_WRITE_ROUTE_AVAILABLE && deps.trackerType(config) === 'github';
  const cars: TrainCar[] = [];
  const waitingSince: number[] = [];
  for (const issueId of candidates) {
    const pr = openById.get(issueId);
    const branch = pr?.branch ?? `feature/${issueId.toLowerCase()}`;
    const facts = await deps.facts(issueId).catch(() => null);
    const run = runs.get(issueId);
    const row = deps.latestAutoMerge(issueId);
    const rowLive = row && (row.status === 'pending' || row.status === 'merging' || row.status === 'failed' || row.status === 'blocked');
    // PRD candidate rule: approved, approved at head or changes requested,
    // unless a row or a run already puts it on the train.
    if (!run && !rowLive && !(facts && (facts.approved || facts.approvedAtHead === true || facts.changesRequested))) continue;
    if (facts && (facts.merged || (facts.exists && !facts.open)) && !runActive(run)) continue;

    const journal = deps.journal(issueId, branch);
    const head = facts?.headSha ?? pr?.headSha ?? null;
    const unresolved = pr ? (threads.get(pr.number) ?? (pr.discussionsOpen ? 1 : 0)) : 0;
    const blockers = blockersOf(facts, unresolved);
    const routing = routingFor(issueId, branch, config, root, trainOn, deps);
    const live = liveBatchOf(issueId);
    const inReadySet = !!facts && facts.approved && facts.checks === 'green' && facts.mergeable === true;
    const failure = run?.phase === 'failed' ? (run.notes ?? 'the last merge failed')
      : row?.status === 'failed' && rowAtHead(row, head) ? (row.failureReason ?? 'the last merge failed')
      // A row re-armed as pending after the journaled failure is newer evidence.
      : row?.status === 'pending' ? null
      : journalFailure(journal);

    let state: CarState;
    let notes: string | null = null;
    if (runActive(run) || row?.status === 'merging') {
      state = 'merging';
      notes = run?.notes ?? null;
    } else if (failure) {
      state = 'failed';
      notes = failure;
    } else if (blockers.length > 0 || row?.status === 'blocked') {
      state = 'blocked';
      notes = row?.status === 'blocked' ? (row.failureReason ?? null) : null;
    } else if (row?.status === 'pending') {
      state = 'cooldown';
    } else if (routing.route === 'batch' && inReadySet && !(live && LIVE_IN_BATCH.has(live.status))) {
      state = 'held';
    } else {
      state = 'ready';
    }
    if (!notes && (state === 'ready' || state === 'held') && skipReason.has(issueId)) {
      notes = `Not scheduled: ${skipReason.get(issueId)}`;
    }
    if (state === 'held' && !routing.heldForUat) waitingSince.push(pr?.readySince ?? now);

    cars.push({
      issueId,
      title: pr?.title ?? deps.issueTitle(issueId) ?? issueId,
      branch,
      // FR-20: one link per member repo for a polyrepo issue.
      prs: identity.polyrepo && pr
        ? listing.open.filter((open) => open.kind === 'feature' && open.issueId === issueId).map((open) => ({ label: prLabel(open), url: open.url }))
        : pr || facts?.url
          ? [{ label: `${forge === 'gitlab' ? '!' : '#'}${pr?.number ?? facts?.number ?? ''}`, url: pr?.url ?? facts?.url ?? null }]
          : [],
      state,
      route: routing.route,
      policy: routing.policy,
      effectivePolicy: routing.heldForUat ? 'hold' : 'auto',
      policyWritable,
      readyAt: facts?.approved ? iso(pr?.readySince) : null,
      mergeAt: state === 'cooldown' ? row?.scheduledMergeAt ?? null : null,
      autoMergeRowId: state === 'cooldown' ? row?.id ?? null : null,
      step: state === 'merging' || state === 'failed' ? stepOf(run) : null,
      notes,
      blockers,
      uatNotes: stringField(lastVerdict(journal), 'uatNotes'),
      liveBatch: live?.name ?? null,
    });
  }
  cars.sort((a, b) => CAR_ORDER.indexOf(a.state) - CAR_ORDER.indexOf(b.state)
    || (Date.parse(a.readyAt ?? '') || Infinity) - (Date.parse(b.readyAt ?? '') || Infinity)
    || a.issueId.localeCompare(b.issueId));

  const strikes: TrainStrike[] = [];
  for (const pr of listing.open.filter((open) => open.kind === 'strike')) {
    strikes.push(await strikeOf(pr, config, root, trainOn, runs.get(pr.issueId), deps));
  }

  const windowApplies = trainOn && identity.mode === 'auto' && forge === 'github' && !identity.polyrepo;
  let window: BatchWindowState | null = null;
  if (windowApplies) {
    const size = deps.batchSize();
    const waitMinutes = deps.batchWaitMinutes();
    const oldest = waitingSince.length > 0 ? Math.min(...waitingSince) : null;
    window = {
      size,
      waitMinutes,
      waiting: waitingSince.length,
      nextBatchAt: oldest === null ? null
        : waitingSince.length >= size ? iso(now) : iso(oldest + waitMinutes * 60_000),
    };
  }

  const recent = await recentMergesForProject({
    listMerged: async () => listing.merged,
    listPromoted: () => deps.promoted(root),
    latestAutoMerge: deps.latestAutoMerge,
    journal: deps.journal,
  });

  const notices = skips.filter((skip) => skip.scope === 'project').map((skip) => `Not scheduled: ${skip.reason}`);
  return { ...identity, window, notices, cars, strikes, batches, recent };
}

/** Every writable member repo's listing, rows tagged with the repo they came from. */
async function polyrepoListing(root: string, config: ProjectConfig, deps: BoardDeps): Promise<ProjectListing> {
  const out: ProjectListing = { open: [], merged: [] };
  for (const repo of deps.memberRepos?.(root, config) ?? []) {
    const listed = await deps.listing(repo.repoPath, repo.forge);
    out.open.push(...listed.open.map((row) => ({ ...row, repoKey: repo.repoKey, forge: repo.forge })));
    out.merged.push(...listed.merged);
  }
  return out;
}

async function strikeOf(
  pr: OpenPr,
  config: ProjectConfig,
  root: string,
  trainOn: boolean,
  run: MergeRun | undefined,
  deps: BoardDeps,
): Promise<TrainStrike> {
  const facts = await deps.facts(pr.issueId, pr.branch, pr.headSha).catch(() => null);
  const row = deps.latestAutoMerge(pr.issueId);
  const journal = deps.journal(pr.issueId, pr.branch);
  const routing = routingFor(pr.issueId, pr.branch, config, root, trainOn, deps);
  const blockers = blockersOf(facts, 0).filter((blocker) => blocker.type !== 'changes_requested');
  const head = facts?.headSha ?? pr.headSha;

  let state: StrikeState;
  let notes: string | null = null;
  let reviewSummary: string | null = null;
  if (runActive(run) || row?.status === 'merging') {
    state = 'merging';
    notes = run?.notes ?? null;
  } else if (run?.phase === 'failed' || (row?.status === 'failed' && rowAtHead(row, head))) {
    state = 'failed';
    notes = run?.notes ?? row?.failureReason ?? null;
  } else if (facts?.changesRequested) {
    state = 'flagged';
    reviewSummary = stringField(lastVerdict(journal, 'CHANGES_REQUESTED'), 'summary');
  } else if (blockers.length > 0) {
    state = 'blocked';
  } else if (facts?.checks !== 'green') {
    state = 'checks-pending';
  } else if (row?.status === 'pending') {
    state = 'queued';
  } else if (!facts || !approvalProvenAtHead(facts)) {
    state = 'reviewing';
  } else {
    state = routing.route === 'batch' ? 'waiting-uat' : 'ready';
  }

  return {
    issueId: pr.issueId,
    title: pr.title ?? deps.issueTitle(pr.issueId) ?? pr.issueId,
    branch: pr.branch,
    prNumber: pr.number,
    prUrl: pr.url ?? '',
    state,
    route: routing.route,
    reviewSummary,
    notes,
    step: state === 'merging' || state === 'failed' ? stepOf(run) : null,
    blockers,
  };
}

/**
 * The board, for every project or one (`projectKey`). Each project is read
 * on its own; a rejection becomes that project's `error` card (NFR-7).
 */
export async function getMergeTrainBoard(
  options: { projectKey?: string } = {},
  deps?: BoardDeps,
): Promise<MergeTrainBoard> {
  // Several tabs and placements poll the same board; one settled read per
  // key serves them for a few seconds (NFR-6). Injected deps bypass it.
  if (!deps) return boardCache(options.projectKey ?? '*', async () => readBoard(options, await defaultBoardDeps()));
  return readBoard(options, deps);
}

const BOARD_CACHE_TTL_MS = 5_000;
const boardCache = createSettledTtlPromiseCache<string, MergeTrainBoard>(BOARD_CACHE_TTL_MS);

async function readBoard(options: { projectKey?: string }, d: BoardDeps): Promise<MergeTrainBoard> {
  const master = d.masterEnabled();
  const projects = d.listProjects().filter((project) => !options.projectKey || project.key === options.projectKey);
  const settled = await Promise.allSettled(projects.map(({ key, config }) => boardProject(key, config, master, d)));
  return {
    masterEnabled: master,
    projects: settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      const { key, config } = projects[index]!;
      let identity: ReturnType<typeof projectIdentity>;
      try {
        identity = projectIdentity(key, config, d, master);
      } catch {
        identity = {
          projectKey: key, projectName: config.name ?? key, repo: null, forge: null, polyrepo: null,
          enabled: false, override: null, mode: 'auto', cooldownMinutes: AUTO_MERGE_COOLDOWN_MS / 60_000,
        };
      }
      return {
        ...identity,
        window: null,
        notices: [],
        cars: [],
        strikes: [],
        batches: [],
        recent: [],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    }),
  };
}

// ─── default wiring ──────────────────────────────────────────────────────────

const BRANCH = /^(feature|strike)\/([a-z][a-z0-9]*-\d+)$/i;

function parseBranch(branch: string | undefined): { kind: 'feature' | 'strike'; issueId: string } | null {
  const match = BRANCH.exec(branch ?? '');
  return match ? { kind: match[1]!.toLowerCase() as 'feature' | 'strike', issueId: match[2]!.toUpperCase() } : null;
}

/** Strike facts skip the shared cache (`preferBranch`), so the board keeps its own, keyed by head. */
const strikeFactsCache = new Map<string, { at: number; facts: PrFacts }>();
const STRIKE_FACTS_TTL_MS = 60_000;

async function defaultBoardDeps(): Promise<BoardDeps> {
  const [
    projects, mergeSync, controls, prFacts, prListing, derived, approval, queue, journalMod,
    trackerType, issueProjects, uatTrain, mergeRoute, threads, doorPolicy, singleton, skipReasons, readySet,
  ] = await Promise.all([
    import('../../../lib/projects.js'),
    import('../../../lib/overdeck/merge-sync.js'),
    import('../../../lib/overdeck/control-settings.js'),
    import('../../../lib/cloister/pr-facts.js'),
    import('../../../lib/overdeck/pr-listing.js'),
    import('../../../lib/overdeck/derived-issue-state.js'),
    import('../../../lib/cloister/approval-at-head.js'),
    import('./merge-queue-service.js'),
    import('../../../lib/cloister/pipeline-journal.js'),
    import('../../../lib/project-tracker-type.js'),
    import('../../../lib/overdeck/issue-projects.js'),
    import('./uat-train.js'),
    import('../../../lib/cloister/merge-route.js'),
    import('../../../lib/cloister/unresolved-threads.js'),
    import('./auto-merge-door-policy.js'),
    import('./issue-service-singleton.js'),
    import('./auto-merge-skip-reasons.js'),
    import('../../../lib/overdeck/ready-set.js'),
  ]);
  const { readySinceFromRollup } = await import('../../../lib/cloister/batch-window.js');

  const githubListing = async (projectPath: string): Promise<ProjectListing> => {
    const rows = await prListing.listRepoPullRequestsStaleOk(projectPath);
    const out: ProjectListing = { open: [], merged: [] };
    for (const row of rows) {
      const parsed = parseBranch(row.headRefName);
      if (!parsed || typeof row.number !== 'number') continue;
      if (row.mergedAt) {
        out.merged.push({
          issueId: parsed.issueId, branch: row.headRefName!, url: row.url ?? null, mergedAt: row.mergedAt,
          sha: row.mergeCommit?.oid ? row.mergeCommit.oid.slice(0, 7) : null,
        });
      } else if ((row.state ?? '').toUpperCase() === 'OPEN') {
        const decision = (row.reviewDecision ?? '').toUpperCase();
        out.open.push({
          ...parsed, branch: row.headRefName!, number: row.number, url: row.url ?? null, title: row.title ?? null,
          headSha: row.headRefOid ?? null, draft: row.isDraft === true,
          reviewDecided: decision === 'APPROVED' || decision === 'CHANGES_REQUESTED',
          readySince: readySinceFromRollup(row),
        });
      }
    }
    return out;
  };

  const gitlabListing = async (projectPath: string): Promise<ProjectListing> => {
    const rows = await derived.listRepoMergeRequests(projectPath);
    const out: ProjectListing = { open: [], merged: [] };
    for (const row of rows) {
      const parsed = parseBranch(row.source_branch);
      if (!parsed || typeof row.iid !== 'number') continue;
      const state = (row.state ?? '').toLowerCase();
      if (state === 'merged' && row.merged_at) {
        out.merged.push({
          issueId: parsed.issueId, branch: row.source_branch!, url: row.web_url ?? null, mergedAt: row.merged_at,
          sha: row.merge_commit_sha ? row.merge_commit_sha.slice(0, 7) : null,
        });
      } else if (state === 'opened') {
        out.open.push({
          ...parsed, branch: row.source_branch!, number: row.iid, url: row.web_url ?? null, title: row.title ?? null,
          headSha: row.sha ?? null, draft: row.draft === true, reviewDecided: row.approved === true, readySince: null,
          discussionsOpen: (row.detailed_merge_status ?? '').toLowerCase() === 'discussions_not_resolved',
        });
      }
    }
    return out;
  };

  return {
    listProjects: () => projects.listProjectsSync(),
    masterEnabled: () => mergeSync.isMergeTrainEnabled(),
    projectEnabled: (config) => mergeSync.isMergeTrainEnabledForProject(config),
    requireUat: () => controls.isFlywheelRequireUatBeforeMerge(),
    forgeOf: (projectPath) => derived.forgeForProject(projectPath),
    listing: (projectPath, forge) => (forge === 'gitlab' ? gitlabListing(projectPath) : githubListing(projectPath)),
    memberRepos: (projectPath, config) => readySet.memberReposForProject(projectPath, config),
    unresolvedThreads: (repoSlug, projectPath) => threads.listUnresolvedThreadCounts(repoSlug, projectPath),
    approvalAtHead: (issueId, headSha) => approval.cachedApprovalAtHead(issueId, headSha),
    facts: async (issueId, strikeBranch, headSha) => {
      if (!strikeBranch) {
        const facts = await prFacts.getPrFacts(issueId);
        return facts.error ? null : facts;
      }
      const key = `${issueId}|${headSha ?? ''}`;
      const hit = strikeFactsCache.get(key);
      if (hit && Date.now() - hit.at < STRIKE_FACTS_TTL_MS) return hit.facts;
      const facts = await prFacts.getPrFacts(issueId, {}, { preferBranch: strikeBranch });
      if (facts.error) return null;
      strikeFactsCache.set(key, { at: Date.now(), facts });
      return facts;
    },
    latestAutoMerge: (issueId) => mergeSync.getLatestAutoMerge(issueId),
    autoMergeRows: () => [...mergeSync.listActiveAutoMerges(), ...mergeSync.listProblemAutoMerges()],
    notScheduled: () => skipReasons.listNotScheduledAutoMerges(),
    mergeRuns: () => queue.listMergeRuns(),
    issueLabels: (issueId) => doorPolicy.cachedIssueLabels(issueId),
    issueTitle: (issueId) => {
      try {
        return singleton.getSharedIssueService().getTrackerIssue(issueId)?.title ?? null;
      } catch {
        return null;
      }
    },
    projectKeyOfIssue: (issueId) => projects.resolveProjectFromIssueSync(issueId)?.projectKey ?? null,
    journal: (issueId, branch) => {
      const feature = issueProjects.getIssueWorkspacePath(issueId);
      if (!feature) return [];
      return journalMod.readPipelineJournal(branch.startsWith('strike/') ? `${feature}-strike` : feature);
    },
    generations: (projectRoot) => uatTrain.getUatGenerationsPayload(projectRoot),
    promoted: (projectRoot) => mergeSync.listUatGenerations({ projectRoot, statuses: ['promoted'], limit: 10 }),
    droppedFromBatch: (issueId, projectRoot) => mergeRoute.droppedFromBatch(issueId, projectRoot),
    lacksBatchCi: (projectRoot) => mergeRoute.projectLacksBatchCi(projectRoot),
    trackerType: (config) => trackerType.tryResolveProjectTrackerType(config),
    batchSize: () => controls.getMergeTrainBatchSize(),
    batchWaitMinutes: () => controls.getMergeTrainBatchWaitMinutes(),
    now: () => Date.now(),
  };
}
