import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { FlywheelPipelineItem } from '@panctl/contracts';

const execAsync = promisify(exec);

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

async function branchExists(branch: string, cwd: string): Promise<boolean> {
  try {
    await execAsync(`git rev-parse --verify ${branch}`, { cwd, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

async function changedFilesVsMain(branch: string, cwd: string): Promise<Set<string>> {
  try {
    const { stdout } = await execAsync(`git diff --name-only main...${branch}`, { cwd, encoding: 'utf8' });
    return new Set(stdout.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function computeMergeQueue(
  items: ReadonlyArray<FlywheelPipelineItem>,
  projectRoot: string,
): Promise<MergeQueueItem[]> {
  const candidates = items.filter((item) => item.verb === 'shipping');
  if (candidates.length === 0) return [];

  const branches = candidates.map((item) => `feature/${item.issueId.toLowerCase()}`);

  const existsFlags = await Promise.all(
    branches.map((branch) => branchExists(branch, projectRoot)),
  );

  const existing = candidates
    .map((item, i) => ({ item, branch: branches[i]!, exists: existsFlags[i]! }))
    .filter(({ exists }) => exists);

  if (existing.length === 0) return [];

  const fileSets = await Promise.all(
    existing.map(({ branch }) => changedFilesVsMain(branch, projectRoot)),
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
}
