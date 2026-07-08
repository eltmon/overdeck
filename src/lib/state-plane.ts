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

export function parsePorcelainStatusPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const pathPart = line.length > 3 ? line.slice(3).trim() : '';
      const path = status.includes('R') ? pathPart.split(' -> ').at(-1) ?? pathPart : pathPart;
      return unquoteGitPath(path);
    })
    .filter(Boolean);
}

export function isStatePlaneOnlyStatus(porcelain: string): boolean {
  return parsePorcelainStatusPaths(porcelain).every(isStatePlanePath);
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

function unquoteGitPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }

  const inner = trimmed.slice(1, -1);
  const bytes: number[] = [];
  let decoded = '';

  const flushBytes = () => {
    if (bytes.length === 0) return;
    decoded += new TextDecoder().decode(Uint8Array.from(bytes));
    bytes.length = 0;
  };

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char !== '\\') {
      flushBytes();
      decoded += char;
      continue;
    }

    const next = inner[index + 1];
    if (next === undefined) {
      flushBytes();
      decoded += '\\';
      continue;
    }

    const octal = inner.slice(index + 1).match(/^[0-7]{1,3}/)?.[0];
    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    flushBytes();
    index += 1;
    switch (next) {
      case 'n':
        decoded += '\n';
        break;
      case 'r':
        decoded += '\r';
        break;
      case 't':
        decoded += '\t';
        break;
      case 'b':
        decoded += '\b';
        break;
      case 'f':
        decoded += '\f';
        break;
      case 'v':
        decoded += '\v';
        break;
      default:
        decoded += next;
        break;
    }
  }

  flushBytes();
  return decoded;
}
