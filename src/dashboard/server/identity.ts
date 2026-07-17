import { existsSync, readFileSync, statSync } from 'node:fs';
import { cwd } from 'node:process';
import { relative, resolve, sep } from 'node:path';

import { parse as parseToml } from '@iarna/toml';

import { CONFIG_FILE } from '../../lib/paths.js';
import { getBuildInfo, type BuildInfo } from '../../lib/deploy/build-info.js';

export type DashboardMode = 'primary' | 'peer';

export interface DashboardIdentity extends BuildInfo {
  readonly repoRoot: string;
  readonly mode: DashboardMode;
}

export function getDashboardIdentity(): DashboardIdentity {
  return {
    repoRoot: resolve(cwd()),
    mode: process.env.OVERDECK_DISABLE_DEACON === '1' ? 'peer' : 'primary',
    ...getBuildInfo(),
  };
}

export function isWorkspaceRepoRoot(repoRoot: string): boolean {
  return /(^|\/)workspaces\/feature-[^/]+$/i.test(repoRoot.replaceAll('\\', '/'));
}

export function isLinkedWorktreeRoot(repoRoot: string): boolean {
  try {
    return statSync(resolve(repoRoot, '.git')).isFile();
  } catch {
    return false;
  }
}

export function primaryRootFromLinkedWorktree(repoRoot: string): string | null {
  try {
    const match = readFileSync(resolve(repoRoot, '.git'), 'utf-8').match(/^gitdir:\s*(.+)$/m);
    const gitDir = match?.[1]?.trim().replaceAll('\\', '/');
    if (!gitDir) return null;

    const worktreeMarker = '/.git/worktrees/';
    const markerIndex = gitDir.indexOf(worktreeMarker);
    return markerIndex === -1 ? null : gitDir.slice(0, markerIndex);
  } catch {
    return null;
  }
}

function isSameOrInside(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
}

export function isNonPrimaryCheckoutRoot(repoRoot: string): boolean {
  const resolvedRoot = resolve(repoRoot);
  return isLinkedWorktreeRoot(resolvedRoot) || isWorkspaceRepoRoot(resolvedRoot);
}

export function readHostDashboardApiPort(defaultPort = 3011): number {
  if (!existsSync(CONFIG_FILE)) return defaultPort;
  try {
    const config = parseToml(readFileSync(CONFIG_FILE, 'utf-8')) as {
      dashboard?: { api_port?: unknown };
    };
    const value = config.dashboard?.api_port;
    return typeof value === 'number' && Number.isFinite(value) ? value : defaultPort;
  } catch {
    return defaultPort;
  }
}

export function shouldRefuseHostDashboardPort(input: {
  readonly repoRoot: string;
  readonly mode: DashboardMode;
  readonly port: number;
  readonly hostDashboardApiPort?: number;
  readonly runningInContainer?: boolean;
}): boolean {
  const hostDashboardApiPort = input.hostDashboardApiPort ?? readHostDashboardApiPort();
  if (input.port !== hostDashboardApiPort) return false;

  const repoRoot = resolve(input.repoRoot);
  const runningInContainer =
    input.runningInContainer ?? (existsSync('/.dockerenv') || repoRoot === '/workspaces/overdeck');
  if (runningInContainer) {
    return false;
  }
  if (input.mode === 'peer') return true;
  if (isNonPrimaryCheckoutRoot(repoRoot)) return true;

  const workspacesDir = resolve(repoRoot, '..');
  return workspacesDir.endsWith(`${sep}workspaces`) && isSameOrInside(workspacesDir, repoRoot);
}
