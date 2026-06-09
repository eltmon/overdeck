import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import type { FlywheelPipelineItem } from '@panctl/contracts';

export interface MergeQueueItem {
  issueId: string;
  title: string;
  pr?: number;
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

export const computeMergeQueue = (
  items: ReadonlyArray<FlywheelPipelineItem>,
  projectRoot: string,
) =>
  Effect.gen(function*() {
    const candidates = items.filter((item) => item.verb === 'shipping');
    if (candidates.length === 0) return [] as MergeQueueItem[];

    const branches = candidates.map((item) => `feature/${item.issueId.toLowerCase()}`);

    const existsFlags = yield* Effect.all(
      branches.map((branch) => branchExists(branch, projectRoot)),
      { concurrency: 'unbounded' },
    );

    const existing = candidates
      .map((item, i) => ({ item, branch: branches[i]!, exists: existsFlags[i]! }))
      .filter(({ exists }) => exists);

    if (existing.length === 0) return [] as MergeQueueItem[];

    const fileSets = yield* Effect.all(
      existing.map(({ branch }) => changedFilesVsMain(branch, projectRoot)),
      { concurrency: 'unbounded' },
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
      pr: item.pr,
      mergeOrder: idx + 1,
      conflictsWith: [...(conflictsMap.get(item.issueId) ?? [])],
      batchGroup: (conflictCount === 0 ? 'batch' : 'serialize') as 'batch' | 'serialize',
    }));
  });
