/**
 * Installed harness CLIs, their versions and their update plans (PAN-4654
 * FR-3, FR-6, D-6, D-7, D-15, D-16).
 *
 * One entry per binary: `kimi` serves both `acp` and `kimi-code`, so it is
 * listed once. The update plan reads only declared capability data
 * (`updateArgs`, `npmPackage`, `binaryLabel`, `installHint`) and never compares
 * harness names. Every exec is `execFile` with an argv, never a shell string.
 */
import { execFile } from 'node:child_process';
import { access, constants as fsConstants, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { compareFleetBinaries, type HarnessCapabilities, type HarnessVersionView, KNOWN_HARNESSES } from '@overdeck/contracts';

import { harnessBinaryName, resolveHarnessBinary } from '../harness-binary.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';

const execFileAsync = promisify(execFile);

/** `<binary> --version` gets this long before it counts as no answer. */
export const VERSION_TIMEOUT_MS = 8_000;
/** A version read is reused this long for the same real path and modification time (NFR-2). */
export const VERSION_CACHE_MS = 60_000;

export interface HarnessUpdatePlan {
  /** The argv Overdeck may run, or null when it must not run anything. */
  argv: string[] | null;
  /** Copyable command. */
  display: string;
  /** Why `argv` is null, or null. */
  reason: string | null;
}

/** An installed CLI with the parts the update job needs; the wire view drops `binaryPath` and `plan`. */
export interface InstalledHarnessCli extends HarnessVersionView {
  binaryPath: string;
  plan: HarnessUpdatePlan;
}

export interface HarnessVersionsDeps {
  resolveBinary: (harness: RuntimeName) => Promise<string | null>;
  realpath: (path: string) => Promise<string>;
  stat: (path: string) => Promise<{ mtimeMs: number }>;
  /** Combined stdout and stderr of `<binaryPath> --version`. */
  execVersion: (binaryPath: string) => Promise<string>;
  canWrite: (dir: string) => Promise<boolean>;
  isExecutable: (path: string) => Promise<boolean>;
  platform: NodeJS.Platform;
  now: () => number;
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function defaultExecVersion(binaryPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, ['--version'], { timeout: VERSION_TIMEOUT_MS, encoding: 'utf8' });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    // A CLI that prints its version and exits non-zero still reports it.
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    return `${stdout ?? ''}\n${stderr ?? ''}`;
  }
}

export const defaultHarnessVersionsDeps: HarnessVersionsDeps = {
  resolveBinary: (harness) => resolveHarnessBinary(harness),
  realpath: (path) => realpath(path),
  stat: (path) => stat(path),
  execVersion: defaultExecVersion,
  canWrite: (dir) => canAccess(dir, fsConstants.W_OK),
  isExecutable: (path) => canAccess(path, fsConstants.X_OK),
  platform: process.platform,
  now: () => Date.now(),
};

/** The first semver-shaped token in a `--version` banner (D-15). */
export function parseCliVersion(output: string): string | null {
  return output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] ?? null;
}

const versionCache = new Map<string, { version: string | null; at: number }>();

export function _resetHarnessVersionCacheForTests(): void {
  versionCache.clear();
}

/** `<binaryPath> --version`, cached 60 s by real path and modification time; `refresh` bypasses and refreshes the cache. */
export async function readCliVersion(
  binaryPath: string,
  opts: { refresh: boolean },
  deps: HarnessVersionsDeps = defaultHarnessVersionsDeps,
): Promise<string | null> {
  let key: string | null = null;
  try {
    const real = await deps.realpath(binaryPath);
    key = `${real}\0${(await deps.stat(real)).mtimeMs}`;
  } catch {
    key = null;
  }
  const cached = key === null ? undefined : versionCache.get(key);
  if (!opts.refresh && cached && deps.now() - cached.at < VERSION_CACHE_MS) return cached.version;
  const version = parseCliVersion(await deps.execVersion(binaryPath));
  if (key !== null) versionCache.set(key, { version, at: deps.now() });
  return version;
}

/**
 * How to update one CLI (D-7). In order: Windows is never run; a binary under
 * `<prefix>/lib/node_modules/<npmPackage>/` is updated with npm into that
 * prefix; a Homebrew install is shown, not run; otherwise the declared
 * `updateArgs`; otherwise nothing.
 */
export async function harnessUpdatePlan(
  capabilities: HarnessCapabilities,
  binary: string,
  binaryPath: string,
  realPath: string,
  deps: HarnessVersionsDeps = defaultHarnessVersionsDeps,
): Promise<HarnessUpdatePlan> {
  const { updateArgs, npmPackage, binaryLabel, installHint } = capabilities;
  const ownCommand = updateArgs ? [binary, ...updateArgs].join(' ') : null;

  if (deps.platform === 'win32') {
    return { argv: null, display: ownCommand ?? installHint ?? '', reason: 'Overdeck does not update CLIs on Windows' };
  }

  const marker = npmPackage ? `/lib/node_modules/${npmPackage}/` : null;
  const markerAt = marker ? realPath.indexOf(marker) : -1;
  if (npmPackage && markerAt >= 0) {
    const prefix = realPath.slice(0, markerAt);
    const npmBinPath = join(prefix, 'bin', 'npm');
    const npmBin = (await deps.isExecutable(npmBinPath)) ? npmBinPath : 'npm';
    const argv = [npmBin, 'install', '-g', '--prefix', prefix, `${npmPackage}@latest`];
    if (await deps.canWrite(join(prefix, 'lib', 'node_modules'))) return { argv, display: argv.join(' '), reason: null };
    return {
      argv: null,
      display: `sudo npm install -g --prefix ${prefix} ${npmPackage}@latest`,
      reason: `${join(prefix, 'lib', 'node_modules')} is not writable`,
    };
  }

  if (realPath.includes('/Caskroom/') || realPath.includes('/Cellar/')) {
    return { argv: null, display: `brew upgrade ${binary}`, reason: 'installed with Homebrew' };
  }

  if (updateArgs && ownCommand) return { argv: [binaryPath, ...updateArgs], display: ownCommand, reason: null };

  return { argv: null, display: installHint ?? '', reason: `Overdeck does not update ${binaryLabel}` };
}

/** Every installed harness CLI, one entry per binary, ordered per D-16. */
export async function detectHarnessClis(
  opts: { refresh: boolean },
  deps: HarnessVersionsDeps = defaultHarnessVersionsDeps,
): Promise<InstalledHarnessCli[]> {
  const groups = new Map<string, { harnesses: RuntimeName[]; binaryPath: string }>();
  for (const name of KNOWN_HARNESSES) {
    const harness = name as RuntimeName;
    const binary = harnessBinaryName(harness);
    const group = groups.get(binary);
    if (group) {
      group.harnesses.push(harness);
      continue;
    }
    const binaryPath = await deps.resolveBinary(harness);
    if (binaryPath) groups.set(binary, { harnesses: [harness], binaryPath });
  }

  const clis = await Promise.all([...groups].map(async ([binary, { harnesses, binaryPath }]) => {
    const capabilities = getHarnessBehavior(harnesses[0]!).capabilities;
    const realPath = await deps.realpath(binaryPath).catch(() => binaryPath);
    const [version, plan] = await Promise.all([
      readCliVersion(binaryPath, opts, deps),
      harnessUpdatePlan(capabilities, binary, binaryPath, realPath, deps),
    ]);
    return {
      binary,
      label: capabilities.binaryLabel,
      harnesses: [...harnesses],
      version,
      updatable: plan.argv !== null,
      command: plan.display,
      reason: plan.reason,
      binaryPath,
      plan,
    } satisfies InstalledHarnessCli;
  }));

  return clis.sort((a, b) => compareFleetBinaries(a.binary, b.binary));
}

/** The wire view of `detectHarnessClis` for `GET /api/versions/self`. */
export async function listInstalledHarnessClis(
  opts: { refresh: boolean },
  deps: HarnessVersionsDeps = defaultHarnessVersionsDeps,
): Promise<HarnessVersionView[]> {
  return (await detectHarnessClis(opts, deps)).map(({ binaryPath: _binaryPath, plan: _plan, ...view }) => view);
}
