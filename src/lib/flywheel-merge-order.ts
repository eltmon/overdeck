import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import type { FlywheelPipelineItem } from '@overdeck/contracts';
import { getReviewStatusSync, mergeGateEligibility, type MergeGateEligibility } from './review-status.js';
import { resolveGitHubIssueSync } from './tracker-utils.js';
import type { SequenceNode } from './backlog/types.js';
import { classifyIssue, isAutoPickable, type ClassifyLookups } from './backlog/pickup.js';
import { compileGlob, type CompiledGlob } from './vbrief/dag.js';
import { computeIssueFootprint } from './vbrief/swarm-readiness.js';
import type { VBriefDocument } from './vbrief/types.js';
import { findProjectByPathSync, getProjectSwarmHotspots } from './projects.js';

export interface MergeQueueItem {
  issueId: string;
  title: string;
  branchName: string;
  pr?: number;
  prUrl?: string;
  mergeOrder: number;
  conflictsWith: string[];
  /** PAN-1691: 'batch' = disjoint, mergeable together in one pass; 'serialize' = conflicts, must go one at a time. */
  batchGroup?: 'batch' | 'serialize';
}

function issueNumber(issueId: string): number {
  const match = issueId.match(/\d+$/);
  return match ? parseInt(match[0], 10) : 0;
}

export interface MergeCandidateMeta {
  issueId: string;
  /** Number of files this branch changes vs main. */
  footprint: number;
  /** How many other ready branches this one overlaps files with. */
  conflictCount: number;
}

export type FootprintSource = 'declared' | 'actual';

export interface IssueFileFootprint {
  issueId: string;
  files: Iterable<string>;
  source: FootprintSource;
}

export interface PredictedConflictSignal extends MergeCandidateMeta {
  source: FootprintSource;
  conflictsWith: string[];
}

/**
 * PAN-1691 conflict-aware merge order. Disjoint (no-conflict) items come first
 * so they can batch through in a single verification pass; then conflicting
 * items broadest-file-footprint first, so the remaining cluster members rebase
 * once onto the worst offender instead of repeatedly. Issue number is the
 * stable tiebreak within each tier. Pure — exported for testing.
 */
export function orderMergeCandidates<T extends MergeCandidateMeta>(items: ReadonlyArray<T>): T[] {
  return [...items].sort((a, b) => {
    const aConf = a.conflictCount > 0 ? 1 : 0;
    const bConf = b.conflictCount > 0 ? 1 : 0;
    if (aConf !== bConf) return aConf - bConf;
    if (aConf === 1 && a.footprint !== b.footprint) return b.footprint - a.footprint;
    return issueNumber(a.issueId) - issueNumber(b.issueId);
  });
}

export interface MergeTrainPlan {
  /** Disjoint candidates that can merge together in one verification pass. */
  batch: string[];
  /** Conflicting candidates that must serialize, broadest-footprint first. */
  serialize: string[];
  /** Full ordered list (batch, then serialize). */
  order: string[];
}

/**
 * PAN-1691 merge-train plan. Partitions the conflict-aware order into the run of
 * disjoint candidates — which can all merge in a single verification pass — and
 * the conflicting remainder, which must serialize broadest-footprint first.
 * Pure; the executor consumes this once the merge-train flag is enabled.
 */
export function planMergeTrain<T extends MergeCandidateMeta>(candidates: ReadonlyArray<T>): MergeTrainPlan {
  const ordered = orderMergeCandidates(candidates);
  return {
    batch: ordered.filter((c) => c.conflictCount === 0).map((c) => c.issueId),
    serialize: ordered.filter((c) => c.conflictCount > 0).map((c) => c.issueId),
    order: ordered.map((c) => c.issueId),
  };
}

export function declaredIssueFootprint(issueId: string, doc: VBriefDocument): IssueFileFootprint {
  return { issueId, files: computeIssueFootprint(doc), source: 'declared' };
}

function pathMatchesAnyCompiled(filePath: string, patterns: CompiledGlob[]): boolean {
  return patterns.some(pattern => pattern.regex.test(filePath) || pattern.exactDirectory === filePath);
}

function normalizedFootprintFiles(files: Iterable<string>, hotspots: CompiledGlob[]): Set<string> {
  const normalized = new Set<string>();
  for (const file of files) {
    if (!file || pathMatchesAnyCompiled(file, hotspots)) continue;
    normalized.add(file);
  }
  return normalized;
}

function sourcePriority(source: FootprintSource): number {
  return source === 'actual' ? 2 : 1;
}

export function computePredictedConflictSignals(
  footprints: ReadonlyArray<IssueFileFootprint>,
  options: { hotspots?: string[] } = {},
): PredictedConflictSignal[] {
  const hotspots = (options.hotspots ?? []).map(compileGlob);
  const byIssue = new Map<string, { issueId: string; source: FootprintSource; files: Set<string> }>();

  for (const footprint of footprints) {
    const files = normalizedFootprintFiles(footprint.files, hotspots);
    const current = byIssue.get(footprint.issueId);
    if (!current || sourcePriority(footprint.source) > sourcePriority(current.source)) {
      byIssue.set(footprint.issueId, { issueId: footprint.issueId, source: footprint.source, files });
      continue;
    }
    if (sourcePriority(footprint.source) === sourcePriority(current.source)) {
      for (const file of files) current.files.add(file);
    }
  }

  const conflictsMap = new Map<string, Set<string>>();
  const entries = Array.from(byIssue.values());
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const left = entries[i]!;
      const right = entries[j]!;
      if (![...left.files].some(file => right.files.has(file))) continue;
      if (!conflictsMap.has(left.issueId)) conflictsMap.set(left.issueId, new Set());
      if (!conflictsMap.has(right.issueId)) conflictsMap.set(right.issueId, new Set());
      conflictsMap.get(left.issueId)!.add(right.issueId);
      conflictsMap.get(right.issueId)!.add(left.issueId);
    }
  }

  return entries.map(entry => {
    const conflictsWith = [...(conflictsMap.get(entry.issueId) ?? [])]
      .sort((a, b) => issueNumber(a) - issueNumber(b));
    return {
      issueId: entry.issueId,
      source: entry.source,
      footprint: entry.files.size,
      conflictCount: conflictsWith.length,
      conflictsWith,
    };
  });
}

export interface UatCandidatePlan {
  /** Branch name for the on-demand UAT candidate (auto-merge-OFF mode). */
  branchName: string;
  /** Issue IDs bundled onto the candidate — the disjoint, mergeable-together batch. */
  bundled: string[];
}

/**
 * PAN-1691 on-demand UAT candidate. In auto-merge-OFF mode the disjoint "batch"
 * (everything that can merge together in one verification pass) is bundled onto
 * a single throwaway branch the human UATs in one sitting. Pure — `dateIso` is
 * injected, and it reads the already-computed `batchGroup` off the merge queue.
 */
export function planUatCandidate(
  queue: ReadonlyArray<MergeQueueItem>,
  opts: { dateIso: string; label?: string },
): UatCandidatePlan {
  const bundled = queue.filter((i) => i.batchGroup === 'batch').map((i) => i.issueId);
  const day = opts.dateIso.slice(0, 10);
  return { branchName: `uat/${opts.label ?? 'candidate'}-${day}`, bundled };
}

const branchExists = (branch: string, cwd: string) =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cmd = ChildProcess.make('git', ['rev-parse', '--verify', branch], { cwd });
    return yield* spawner.exitCode(cmd).pipe(
      Effect.map((code) => code === 0),
      Effect.orElseSucceed(() => false),
    );
  });

export const changedFilesVsMain = (branch: string, cwd: string, base = 'main') =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cmd = ChildProcess.make('git', ['diff', '--name-only', `${base}...${branch}`], { cwd });
    return yield* spawner.string(cmd).pipe(
      Effect.map((stdout) => new Set(stdout.trim().split('\n').filter(Boolean))),
      Effect.orElseSucceed(() => new Set<string>()),
    );
  });

/**
 * Verbs that mean "at the merge gate" (PAN-1736). Orchestrators have
 * legitimately emitted both 'shipping' and 'merging' for merge-ready issues;
 * filtering on one alone silently rendered an empty queue with five ready
 * items in RUN-18. Contract documented next to FlywheelPipelineVerb in
 * packages/contracts/src/flywheel.ts — extend BOTH places together.
 */
export const MERGE_GATE_VERBS: ReadonlySet<FlywheelPipelineItem['verb']> = new Set(['shipping', 'merging']);

export const MERGE_QUEUE_GIT_CONCURRENCY = 4;

export interface ComputeMergeQueueOptions {
  getPrUrl?: (item: FlywheelPipelineItem) => string | undefined;
  gitConcurrency?: number;
  /**
   * Authoritative merge eligibility per issue (PAN-1759). Defaults to the
   * review-status DB predicate; injectable for tests. The verb filter alone is
   * the orchestrator's INTENT — an LLM emission that has tagged mid-review
   * issues as merge-bound. Only verb ∩ eligibility enters the queue.
   */
  eligibility?: (issueId: string) => MergeGateEligibility;
  /** Called for each verb-tagged item the eligibility gate rejects. */
  onIneligible?: (issueId: string, reason: string) => void;
  /** Files treated as common hotspots and excluded from predicted-conflict math. */
  hotspots?: string[];
}

/** Default eligibility: the issue's review-status record, read synchronously. */
export function reviewRecordEligibility(issueId: string): MergeGateEligibility {
  return mergeGateEligibility(getReviewStatusSync(issueId.toUpperCase()));
}

/**
 * Server-side PR URL resolution for merge-queue items: prefer the review
 * status record, fall back to the GitHub repo + PR number — the browser never
 * guesses repo slugs.
 */
export function resolveMergeQueuePrUrl(item: { issueId: string; pr?: number }): string | undefined {
  const issueId = item.issueId.toUpperCase();
  const reviewStatus = getReviewStatusSync(issueId);
  if (reviewStatus?.prUrl) return reviewStatus.prUrl;

  const prNumber = reviewStatus?.prNumber ?? item.pr;
  if (prNumber === undefined) return undefined;

  const githubIssue = resolveGitHubIssueSync(issueId);
  if (!githubIssue.isGitHub) return undefined;
  return `https://github.com/${githubIssue.owner}/${githubIssue.repo}/pull/${prNumber}`;
}

export const computeMergeQueue = (
  items: ReadonlyArray<FlywheelPipelineItem>,
  projectRoot: string,
  options: ComputeMergeQueueOptions = {},
) =>
  Effect.gen(function*() {
    const eligibility = options.eligibility ?? reviewRecordEligibility;
    const candidates = items.filter((item) => {
      if (!MERGE_GATE_VERBS.has(item.verb)) return false;
      const gate = eligibility(item.issueId);
      if (!gate.eligible) {
        options.onIneligible?.(item.issueId, gate.reason ?? 'not eligible');
        return false;
      }
      return true;
    });
    if (candidates.length === 0) return [] as MergeQueueItem[];
    const gitConcurrency = Math.max(1, Math.floor(options.gitConcurrency ?? MERGE_QUEUE_GIT_CONCURRENCY));

    const branches = candidates.map((item) => `feature/${item.issueId.toLowerCase()}`);

    const existsFlags = yield* Effect.all(
      branches.map((branch) => branchExists(branch, projectRoot)),
      { concurrency: gitConcurrency },
    );

    const existing = candidates
      .map((item, i) => ({ item, branch: branches[i]!, exists: existsFlags[i]! }))
      .filter(({ exists }) => exists);

    if (existing.length === 0) return [] as MergeQueueItem[];

    const fileSets = yield* Effect.all(
      existing.map(({ branch }) => changedFilesVsMain(branch, projectRoot)),
      { concurrency: gitConcurrency },
    );
    const hotspots = options.hotspots ?? getProjectSwarmHotspots(findProjectByPathSync(projectRoot));
    const conflictSignals = computePredictedConflictSignals(
      existing.map((e, i) => ({ issueId: e.item.issueId, source: 'actual' as const, files: fileSets[i]! })),
      { hotspots },
    );
    const signalByIssue = new Map(conflictSignals.map(signal => [signal.issueId, signal]));
    const conflictsMap = new Map(conflictSignals.map(signal => [signal.issueId, new Set(signal.conflictsWith)]));

    // PAN-1691: conflict-aware order. Disjoint (no-conflict) items go first so
    // they can batch through in a single verification pass; then conflicting
    // items broadest-file-footprint first, so the remaining cluster members
    // rebase once onto the worst offender instead of repeatedly. Issue number
    // is the stable tiebreak within each tier.
    const sorted = orderMergeCandidates(
      existing.map((e, i) => ({
        item: e.item,
        issueId: e.item.issueId,
        footprint: signalByIssue.get(e.item.issueId)?.footprint ?? fileSets[i]!.size,
        conflictCount: signalByIssue.get(e.item.issueId)?.conflictCount ?? 0,
      })),
    );

    return sorted.map(({ item, conflictCount }, idx) => ({
      issueId: item.issueId,
      title: item.title,
      branchName: `feature/${item.issueId.toLowerCase()}`,
      pr: item.pr,
      prUrl: options.getPrUrl?.(item),
      mergeOrder: idx + 1,
      conflictsWith: [...(conflictsMap.get(item.issueId) ?? [])],
      batchGroup: (conflictCount === 0 ? 'batch' : 'serialize') as 'batch' | 'serialize',
    }));
  });

export interface SequencePickResult {
  issueId: string;
  rank: number;
  gate: string;
  planning: string;
  predictedConflictCount?: number;
  predictedConflictsWith?: string[];
}


/**
 * PAN-1866: Pick the highest-ranked eligible issue from a sequence node list.
 *
 * Eligibility rules:
 * - gate must not be 'blocked' (the `vetoed` pickup state)
 * - no `vetoed` label — an absolute operator hard-stop (PAN-2006)
 * - not in-pipeline (active review/work/test)
 * - no parked labels (`parked`; legacy `needs-design`/`needs-discussion`)
 * - not in the optional exclusion set (e.g. already running agents)
 * - FR-14: must have a vBRIEF spec (ready) or a PRD draft (hasPrd)
 *
 * Returns null when no eligible issue is found.
 */
export function pickFromSequence(
  nodes: ReadonlyArray<SequenceNode>,
  opts?: {
    excludeIssueIds?: ReadonlySet<string>;
    issueLabels?: (issueId: string) => ReadonlyArray<string>;
    /** Flywheel author/assignee safety gate. Return false to skip an issue. When
     *  absent every issue passes (backward-compatible default). */
    isAuthorizedIssue?: (issueId: string) => boolean;
    /** FR-14 eligibility gate. Return true if the issue has a vBRIEF spec (ready)
     *  or a PRD draft (hasPrd). When absent every issue passes (backward-compatible
     *  default). */
    isReadyOrHasPrd?: (issueId: string) => boolean;
    /** Supplement the built-in review-status inPipeline check with live workspace/agent
     *  state. Return true to treat an issue as in-pipeline and skip it. When absent only
     *  review_status is checked (backward-compatible default). */
    isInPipeline?: (issueId: string) => boolean;
    /** PAN-2006 Definition of Ready: when true, only issues carrying the `ready`
     *  label are eligible (the hard entry gate). The live Flywheel passes true;
     *  legacy callers omit it and keep their pre-DoR behavior. */
    requireReady?: boolean;
    /** PAN-2059 + vision.mdx blanket release: when auto-pickup is ON the toggle
     *  satisfies the per-issue `released` gate for the whole backlog. The live Flywheel
     *  passes its auto_pickup_backlog setting; legacy callers omit it (default OFF). */
    autoPickupBacklog?: boolean;
    /**
     * Advisory pre-branch conflict signal. When present, lower predicted-conflict
     * counts sort first among otherwise pickable issues; no issue is filtered out.
     */
    predictedConflictSignals?: ReadonlyArray<PredictedConflictSignal>;
  },
): SequencePickResult | null {
  // Single source of truth: the same classifier the Forecast UI uses (PAN-2006).
  // `isReadyOrHasPrd` maps to the module's `planned` gate; review_status + the
  // optional callback feed the `inPipeline` gate; vetoed / parked / gate-blocked are
  // derived from labels + the node's gate inside classifyIssue.
  const lookups: ClassifyLookups = {
    labels: opts?.issueLabels ?? (() => []),
    isPlanned: opts?.isReadyOrHasPrd ?? (() => true),
    isInPipeline: (issueId) => {
      const reviewStatus = getReviewStatusSync(issueId.toUpperCase());
      return (reviewStatus !== null && reviewStatus.reviewStatus !== 'pending') ||
        (opts?.isInPipeline?.(issueId) ?? false);
    },
  };

  const signalByIssue = new Map((opts?.predictedConflictSignals ?? []).map(signal => [signal.issueId.toUpperCase(), signal]));
  const eligible = [...nodes]
    .sort((a, b) => a.rank - b.rank)
    .filter((node) => {
      const state = classifyIssue(node, lookups);
      // DoR is conditional: when not required, treat readiness as satisfied so the
      // remaining gates (planned / parked / vetoed / in-pipeline) still apply.
      if (!isAutoPickable(opts?.requireReady ? state : { ...state, ready: true }, opts?.autoPickupBacklog ?? false)) return false;
      if (opts?.excludeIssueIds?.has(node.issue)) return false;
      if (opts?.isAuthorizedIssue && !opts.isAuthorizedIssue(node.issue)) return false;
      return true;
    });

  if (signalByIssue.size > 0) {
    eligible.sort((a, b) => {
      const aSignal = signalByIssue.get(a.issue.toUpperCase());
      const bSignal = signalByIssue.get(b.issue.toUpperCase());
      const aConflicts = aSignal?.conflictCount ?? 0;
      const bConflicts = bSignal?.conflictCount ?? 0;
      if (aConflicts !== bConflicts) return aConflicts - bConflicts;
      return a.rank - b.rank;
    });
  }

  for (const node of eligible) {
    const state = classifyIssue(node, lookups);
    const signal = signalByIssue.get(node.issue.toUpperCase());
    return {
      issueId: node.issue,
      rank: node.rank,
      gate: node.gate,
      planning: node.planning,
      predictedConflictCount: signal?.conflictCount,
      predictedConflictsWith: signal?.conflictsWith,
    };
  }
  return null;
}
