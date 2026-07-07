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
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--name-only', baseCommit, headCommit],
    { cwd: workspacePath, encoding: 'utf-8' },
  );
  const changedPaths = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return changedPaths.length > 0 && changedPaths.every(isPipelineStatePath);
}
