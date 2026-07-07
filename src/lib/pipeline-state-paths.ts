import { execFile } from 'child_process';
import { promisify } from 'util';
import { isStatePlanePath } from './state-plane.js';

const execFileAsync = promisify(execFile);

export function isPipelineStatePath(relativePath: string): boolean {
  return isStatePlanePath(relativePath);
}

export async function hasOnlyPipelineStateChangesSinceCommit(
  workspacePath: string,
  baseCommit: string,
  headCommit = 'HEAD',
): Promise<boolean> {
  const changedPaths = await changedPathsBetween(workspacePath, baseCommit, headCommit);
  return changedPaths.length > 0 && changedPaths.every(isPipelineStatePath);
}

export async function getEffectiveCodeCommit(
  workspacePath: string,
  headCommit = 'HEAD',
): Promise<string> {
  let current = (await gitStdout(workspacePath, ['rev-parse', headCommit])).trim();
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    seen.add(current);

    let parent: string;
    try {
      parent = (await gitStdout(workspacePath, ['rev-parse', `${current}^`])).trim();
    } catch {
      return current;
    }

    const changedPaths = await changedPathsBetween(workspacePath, parent, current);
    if (changedPaths.length > 0 && changedPaths.every(isPipelineStatePath)) {
      current = parent;
      continue;
    }

    return current;
  }

  return current;
}

export async function haveSameEffectiveCodeCommit(
  workspacePath: string,
  leftCommit: string,
  rightCommit: string,
): Promise<boolean> {
  const [leftEffective, rightEffective] = await Promise.all([
    getEffectiveCodeCommit(workspacePath, leftCommit),
    getEffectiveCodeCommit(workspacePath, rightCommit),
  ]);
  return leftEffective === rightEffective;
}

async function changedPathsBetween(
  workspacePath: string,
  baseCommit: string,
  headCommit: string,
): Promise<string[]> {
  const stdout = await gitStdout(workspacePath, ['diff', '--name-only', baseCommit, headCommit]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function gitStdout(workspacePath: string, args: string[]): Promise<string> {
  const result = await execFileAsync(
    'git',
    args,
    { cwd: workspacePath, encoding: 'utf-8' },
  ) as unknown;
  if (typeof result === 'string') return result;
  return String((result as { stdout?: unknown }).stdout ?? '');
}
