import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import type { FlywheelPipelineItem } from '@panctl/contracts';

export interface MergeQueueItem {
  issueId: string;
  title: string;
  pr?: number;
  mergeOrder: number;
  conflictsWith: string[];
}

function issueNumber(issueId: string): number {
  const match = issueId.match(/\d+$/);
  return match ? parseInt(match[0], 10) : 0;
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

    const sorted = [...existing].sort(
      (a, b) => issueNumber(a.item.issueId) - issueNumber(b.item.issueId),
    );

    return sorted.map(({ item }, idx) => ({
      issueId: item.issueId,
      title: item.title,
      pr: item.pr,
      mergeOrder: idx + 1,
      conflictsWith: [...(conflictsMap.get(item.issueId) ?? [])],
    }));
  });
