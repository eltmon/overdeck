import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const STATE_PLANE_PATHS = [
  '.pan/records/',
  '.pan/continues/',
  '.pan/continue.json',
  // The policy path-includes .pan/specs/; callers must still scope this to status-field flips.
  '.pan/specs/',
  '.beads/',
  '.pan/test/',
  '.pan/review/',
  '.pan/feedback/',
] as const;

export type StatePlanePath = typeof STATE_PLANE_PATHS[number];

export function isStatePlanePath(relativePath: string): boolean {
  const normalized = relativePath.trim().replace(/\\/g, '/');
  return STATE_PLANE_PATHS.some((statePath) => {
    if (statePath.endsWith('/')) {
      return normalized === statePath.slice(0, -1) || normalized.startsWith(statePath);
    }
    return normalized === statePath;
  });
}

export async function isStatePlaneOnlyDiff(
  baseSha: string,
  tipSha: string,
  repoRoot: string,
): Promise<boolean> {
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--name-only', baseSha, tipSha],
    { cwd: repoRoot, encoding: 'utf-8' },
  );

  const changedPaths = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return changedPaths.every(isStatePlanePath);
}
