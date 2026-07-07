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

export interface MainDivergence {
  ahead: number;
  behind: number;
}

export async function getMainDivergence(repoPath: string): Promise<MainDivergence> {
  try {
    const [ahead, behind] = await Promise.all([
      countRevisionRange('origin/main..main', repoPath),
      countRevisionRange('main..origin/main', repoPath),
    ]);
    return { ahead, behind };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

async function countRevisionRange(range: string, repoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    'git',
    ['rev-list', '--count', range],
    { cwd: repoPath, encoding: 'utf-8' },
  );
  const count = Number.parseInt(stdout.trim(), 10);
  return Number.isFinite(count) ? count : 0;
}
