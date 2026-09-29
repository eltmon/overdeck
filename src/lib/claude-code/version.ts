/**
 * Claude Code CLI version detection, install-method classification, and
 * upgrade-plan derivation (PAN-4359). Pure classification (`detectClaudeInstall`)
 * is separated from the subprocess/filesystem reads so tests can drive it with
 * table data instead of a real binary.
 */

import { execFile } from 'node:child_process';
import { access, constants as fsConstants, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { extractSemver } from '../herdr-setup/binary.js';

const execFileAsync = promisify(execFile);

/** A launch pays at most one `claude --version` per binary per this window (NFR-2). */
const VERSION_CACHE_TTL_MS = 60_000;
const VERSION_EXEC_TIMEOUT_MS = 10_000;

export type ClaudeInstallMethod = 'npm' | 'native' | 'homebrew' | 'unknown';

export interface ClaudeInstall {
  readonly method: ClaudeInstallMethod;
  readonly realPath: string;
  readonly npmPrefix?: string;
}

export interface ClaudeUpgradePlan {
  readonly method: ClaudeInstallMethod;
  /** null when not runnable */
  readonly argv: string[] | null;
  /** copyable command shown to the operator */
  readonly display: string;
  readonly runnable: boolean;
  readonly reason?: 'not-writable' | 'unknown-install' | 'unsupported-platform' | 'brew-missing';
}

export interface VersionExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** The subprocess seam for `readClaudeCodeVersion` — always `execFile`, never a blocking exec. */
export type VersionExec = (binaryPath: string) => Promise<VersionExecResult>;

const defaultVersionExec: VersionExec = async (binaryPath) => {
  const { stdout, stderr } = await execFileAsync(binaryPath, ['--version'], {
    encoding: 'utf-8',
    timeout: VERSION_EXEC_TIMEOUT_MS,
  });
  return { stdout, stderr };
};

/** The first `X.Y.Z` in a version banner (`2.1.284 (Claude Code)` → `2.1.284`), or null. */
export function parseClaudeCodeVersion(output: string): string | null {
  return extractSemver(output);
}

interface VersionCacheEntry {
  readonly promise: Promise<string | null>;
  readonly cachedAt: number;
}

const versionCache = new Map<string, VersionCacheEntry>();

/** Drops all cached version reads; call between tests that inject their own clock/exec. */
export function resetClaudeCodeVersionCacheForTests(): void {
  versionCache.clear();
}

/**
 * `null` when the binary cannot answer (missing, times out, or prints no
 * `X.Y.Z`) — never throws. Cached by `${realpath}:${mtimeMs}` for 60 s so an
 * upgrade (which changes the mtime or the real path) misses the cache
 * immediately instead of waiting out the TTL.
 */
export async function readClaudeCodeVersion(
  binaryPath: string,
  opts: { refresh?: boolean; exec?: VersionExec; now?: () => number } = {},
): Promise<string | null> {
  const exec = opts.exec ?? defaultVersionExec;
  const now = opts.now ?? Date.now;

  let cacheKey: string | null = null;
  try {
    const realPath = await realpath(binaryPath);
    const stats = await stat(realPath);
    cacheKey = `${realPath}:${stats.mtimeMs}`;
  } catch {
    cacheKey = null;
  }

  if (cacheKey && !opts.refresh) {
    const cached = versionCache.get(cacheKey);
    if (cached && now() - cached.cachedAt < VERSION_CACHE_TTL_MS) {
      return cached.promise;
    }
  }

  const promise = (async () => {
    try {
      const { stdout, stderr } = await exec(binaryPath);
      return parseClaudeCodeVersion(stdout) ?? parseClaudeCodeVersion(stderr);
    } catch {
      return null;
    }
  })();

  if (cacheKey) {
    versionCache.set(cacheKey, { promise, cachedAt: now() });
  }

  return promise;
}

/**
 * Classifies a Claude Code binary's real path into an install method. Pure —
 * no filesystem or subprocess access — so callers resolve the real path once
 * (e.g. via `readClaudeCodeVersion`'s own `realpath` call or `fs.realpath`)
 * and pass it in.
 */
export function detectClaudeInstall(realPath: string, home: string = homedir()): ClaudeInstall {
  const nativePrefixes = [`${join(home, '.local', 'share', 'claude')}/`, `${join(home, '.claude', 'local')}/`];
  if (nativePrefixes.some((prefix) => realPath.startsWith(prefix))) {
    return { method: 'native', realPath };
  }
  if (realPath.includes('/Caskroom/claude-code/')) {
    return { method: 'homebrew', realPath };
  }
  const npmMatch = realPath.match(/^(.*)\/lib\/node_modules\/@anthropic-ai\/claude-code\//);
  if (npmMatch) {
    return { method: 'npm', realPath, npmPrefix: npmMatch[1] };
  }
  return { method: 'unknown', realPath };
}

export interface ClaudeUpgradePlanDeps {
  readonly platform?: NodeJS.Platform;
  readonly canWrite?: (dir: string) => Promise<boolean>;
  readonly resolveBrew?: () => Promise<string | null>;
  readonly isExecutable?: (path: string) => Promise<boolean>;
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

const defaultCanWrite = (dir: string): Promise<boolean> => canAccess(dir, fsConstants.W_OK);
const defaultIsExecutable = (path: string): Promise<boolean> => canAccess(path, fsConstants.X_OK);

async function defaultResolveBrew(): Promise<string | null> {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'brew');
    if (await defaultIsExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * Derives the upgrade command for an install, and whether Overdeck may run it
 * itself (PAN-4359 D5/D6/D10). Not-runnable plans always carry a copyable
 * `display` command; `argv` is null for those.
 */
export async function claudeCodeUpgradePlan(
  install: ClaudeInstall,
  deps: ClaudeUpgradePlanDeps = {},
): Promise<ClaudeUpgradePlan> {
  const platform = deps.platform ?? process.platform;
  const canWrite = deps.canWrite ?? defaultCanWrite;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const resolveBrew = deps.resolveBrew ?? defaultResolveBrew;

  let plan: ClaudeUpgradePlan;

  switch (install.method) {
    case 'native': {
      plan = { method: 'native', argv: [install.realPath, 'update'], display: 'claude update', runnable: true };
      break;
    }
    case 'npm': {
      const prefix = install.npmPrefix ?? '';
      const modulesDir = join(prefix, 'lib', 'node_modules');
      const npmBinPath = join(prefix, 'bin', 'npm');
      const npmBin = (await isExecutable(npmBinPath)) ? npmBinPath : 'npm';
      const argv = [npmBin, 'install', '-g', '--prefix', prefix, '@anthropic-ai/claude-code@latest'];
      const writable = await canWrite(modulesDir);
      plan = writable
        ? { method: 'npm', argv, display: argv.join(' '), runnable: true }
        : {
            method: 'npm',
            argv: null,
            display: `sudo npm install -g --prefix ${prefix} @anthropic-ai/claude-code@latest`,
            runnable: false,
            reason: 'not-writable',
          };
      break;
    }
    case 'homebrew': {
      // D10 fallback: the cask name (`brew upgrade --cask claude-code`) is unconfirmed,
      // so Homebrew installs always render a copyable command rather than a button.
      const brewPath = await resolveBrew();
      plan = {
        method: 'homebrew',
        argv: null,
        display: 'brew upgrade claude-code',
        runnable: false,
        ...(brewPath ? {} : ({ reason: 'brew-missing' } as const)),
      };
      break;
    }
    case 'unknown':
    default: {
      plan = { method: 'unknown', argv: null, display: 'claude update', runnable: false, reason: 'unknown-install' };
      break;
    }
  }

  if (platform === 'win32') {
    return { ...plan, argv: null, runnable: false, reason: 'unsupported-platform' };
  }
  return plan;
}

export interface ClaudeBinaryOnPath {
  readonly path: string;
  readonly realPath: string;
}

export interface ListClaudeBinariesDeps {
  readonly access?: (path: string, mode: number) => Promise<void>;
  readonly realpath?: (path: string) => Promise<string>;
}

/** Every `claude` executable on `PATH`, in `PATH` order, deduped by real path. */
export async function listClaudeBinariesOnPath(
  pathValue: string = process.env.PATH ?? '',
  deps: ListClaudeBinariesDeps = {},
): Promise<ClaudeBinaryOnPath[]> {
  const accessFn = deps.access ?? access;
  const realpathFn = deps.realpath ?? realpath;
  const seen = new Set<string>();
  const result: ClaudeBinaryOnPath[] = [];

  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'claude');
    try {
      await accessFn(candidate, fsConstants.X_OK);
    } catch {
      continue;
    }
    let realPath: string;
    try {
      realPath = await realpathFn(candidate);
    } catch {
      continue;
    }
    if (seen.has(realPath)) continue;
    seen.add(realPath);
    result.push({ path: candidate, realPath });
  }

  return result;
}
