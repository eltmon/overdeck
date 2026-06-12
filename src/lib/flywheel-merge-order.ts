import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import type { FlywheelPipelineItem } from '@panctl/contracts';
import { getReviewStatusSync, mergeGateEligibility, type MergeGateEligibility } from './review-status.js';
import { getAllReviewStatusesFromDb } from './database/review-status-db.js';
import { resolveProjectFromIssueSync } from './projects.js';
import { resolveGitHubIssueSync } from './tracker-utils.js';

export interface MergeCandidate {
  issueId: string;
  title: string;
  pr?: number;
}

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

const changedFilesVsMain = (branch: string, cwd: string) =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cmd = ChildProcess.make('git', ['diff', '--name-only', `main...${branch}`], { cwd });
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
  getPrUrl?: (item: MergeCandidate) => string | undefined;
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
  computeMergeQueueFromCandidates(
    items
      .filter((item) => MERGE_GATE_VERBS.has(item.verb))
      .map((item) => ({ issueId: item.issueId, title: item.title, ...(item.pr !== undefined ? { pr: item.pr } : {}) })),
    projectRoot,
    options,
  );

export const computeMergeQueueFromCandidates = (
  candidates: ReadonlyArray<MergeCandidate>,
  projectRoot: string,
  options: ComputeMergeQueueOptions = {},
) =>
  Effect.gen(function*() {
    const eligibility = options.eligibility ?? reviewRecordEligibility;
    const eligibleCandidates = candidates.filter((item) => {
      const gate = eligibility(item.issueId);
      if (!gate.eligible) {
        options.onIneligible?.(item.issueId, gate.reason ?? 'not eligible');
        return false;
      }
      return true;
    });
    if (eligibleCandidates.length === 0) return [] as MergeQueueItem[];
    const gitConcurrency = Math.max(1, Math.floor(options.gitConcurrency ?? MERGE_QUEUE_GIT_CONCURRENCY));

    const branches = eligibleCandidates.map((item) => `feature/${item.issueId.toLowerCase()}`);

    const existsFlags = yield* Effect.all(
      branches.map((branch) => branchExists(branch, projectRoot)),
      { concurrency: gitConcurrency },
    );

    const existing = eligibleCandidates
      .map((item, i) => ({ item, branch: branches[i]!, exists: existsFlags[i]! }))
      .filter(({ exists }) => exists);

    if (existing.length === 0) return [] as MergeQueueItem[];

    const fileSets = yield* Effect.all(
      existing.map(({ branch }) => changedFilesVsMain(branch, projectRoot)),
      { concurrency: gitConcurrency },
    );

    const conflictsMap = new Map<string, Set<string>>();
    for (let i = 0; i < existing.length; i++) {
      for (let j = i + 1; j < existing.length; j++) {
        const idA = existing[i]!.item.issueId;
        const idB = existing[j]!.item.issueId;
        if ([...fileSets[i]!].some((f) => fileSets[j]!.has(f))) {
          if (!conflictsMap.has(idA)) conflictsMap.set(idA, new Set());
          if (!conflictsMap.has(idB)) conflictsMap.set(idB, new Set());
          conflictsMap.get(idA)!.add(idB);
          conflictsMap.get(idB)!.add(idA);
        }
      }
    }

    // PAN-1691: conflict-aware order. Disjoint (no-conflict) items go first so
    // they can batch through in a single verification pass; then conflicting
    // items broadest-file-footprint first, so the remaining cluster members
    // rebase once onto the worst offender instead of repeatedly. Issue number
    // is the stable tiebreak within each tier.
    const sorted = orderMergeCandidates(
      existing.map((e, i) => ({
        item: e.item,
        issueId: e.item.issueId,
        footprint: fileSets[i]!.size,
        conflictCount: conflictsMap.get(e.item.issueId)?.size ?? 0,
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

export interface EligibleCandidatesByProject {
  projectKey: string;
  projectRoot: string;
  candidates: MergeCandidate[];
}

export function listEligibleCandidatesByProject(opts: { titleFor?: (issueId: string) => string | undefined } = {}): Map<string, EligibleCandidatesByProject> {
  const statuses = getAllReviewStatusesFromDb();
  const groups = new Map<string, EligibleCandidatesByProject>();

  for (const [recordIssueId, status] of Object.entries(statuses)) {
    const gate = mergeGateEligibility(status);
    if (!gate.eligible || status.deaconIgnored === true) continue;
    const issueId = status.issueId || recordIssueId;
    const project = resolveProjectFromIssueSync(issueId);
    if (!project) continue;

    const group = groups.get(project.projectKey) ?? {
      projectKey: project.projectKey,
      projectRoot: project.projectPath,
      candidates: [],
    };
    group.candidates.push({
      issueId,
      title: opts.titleFor?.(issueId) ?? issueId,
      ...(status.prNumber !== undefined ? { pr: status.prNumber } : {}),
    });
    groups.set(project.projectKey, group);
  }

  return groups;
}
