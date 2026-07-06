import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function isPipelineStatePath(relativePath: string): boolean {
  const normalized = relativePath.trim().replace(/\\/g, '/');
  return normalized.startsWith('.pan/records/')
    || normalized === '.pan/continue.json'
    || normalized.startsWith('.pan/continue')
    || normalized.startsWith('.pan/specs/')
    || normalized === '.beads'
    || normalized.startsWith('.beads/');
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
