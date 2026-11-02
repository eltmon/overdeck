/**
 * The durable runtime for `pan connect` under npx (PAN-4656, D-4, D-5).
 *
 * `npx @overdeck/core connect` runs from `~/.npm/_npx/<hash>/…`, a cache npm
 * may prune at any time, so nothing that must outlive the command may point
 * into it. `pan connect` installs the exact running version into
 * `<OVERDECK_HOME>/runtime` with `npm install --prefix` (never `--global`: a
 * system Node's global prefix needs sudo), then re-runs itself from there with
 * `OVERDECK_CONNECT_REEXEC=1` so every path it writes agrees.
 *
 * Async only: npm runs through `execFile` with a 600 s timeout.
 *
 * Update all and `pan update` reinstall into this same runtime when the
 * running package root is inside it (PAN-4722, `isRuntimePackageRoot`).
 */

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const CONNECT_REEXEC_ENV = 'OVERDECK_CONNECT_REEXEC';

const NPM_INSTALL_TIMEOUT_MS = 600_000;
const NPM_STDERR_LINES = 20;
const REQUIRED_FILES = ['dist/cli/index.js', 'dist/supervisor/server.js'] as const;

export interface ConnectRuntimeDeps {
  execFile: (file: string, args: readonly string[], options: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;
  /** File contents, or null when it cannot be read. */
  readFile: (path: string) => Promise<string | null>;
  fileExists: (path: string) => Promise<boolean>;
}

const execFileAsync = promisify(execFile);

const defaultDeps: ConnectRuntimeDeps = {
  execFile: async (file, args, options) => {
    const { stdout, stderr } = await execFileAsync(file, [...args], {
      encoding: 'utf-8',
      timeout: options.timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout, stderr };
  },
  readFile: async (path) => {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return null;
    }
  },
  fileExists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
};

function resolveDeps(deps: Partial<ConnectRuntimeDeps> = {}): ConnectRuntimeDeps {
  return { ...defaultDeps, ...deps };
}

/** True when `root` has a path segment `_npx` (`/_npx/` or `\_npx\`). */
export function isNpxCacheRoot(root: string): boolean {
  return root.split(/[\\/]/).includes('_npx');
}

function runtimePrefix(overdeckHome: string): string {
  return join(overdeckHome, 'runtime');
}

export function runtimePackageRoot(overdeckHome: string): string {
  return join(runtimePrefix(overdeckHome), 'node_modules', '@overdeck', 'core');
}

/** `path` with symlinks resolved, or just normalized when it does not exist. */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * True when `root` is the package `pan connect` installed into
 * `<overdeckHome>/runtime` (PAN-4722): updates must go there, not to the
 * global npm prefix. Sync because its callers are sync; it is one realpath,
 * not a child process.
 */
export function isRuntimePackageRoot(root: string, overdeckHome: string): boolean {
  return canonicalPath(root) === canonicalPath(runtimePackageRoot(overdeckHome));
}

/** Installed version at the runtime root, or null. */
export async function readRuntimeVersion(overdeckHome: string, deps?: Partial<ConnectRuntimeDeps>): Promise<string | null> {
  const raw = await resolveDeps(deps).readFile(join(runtimePackageRoot(overdeckHome), 'package.json'));
  if (raw === null) return null;
  try {
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

function lastLines(text: string, count: number): string {
  return text.trimEnd().split('\n').slice(-count).join('\n');
}

/**
 * No-op when the runtime already has `version`; else installs
 * `@overdeck/core@<version>` into `<home>/runtime` and checks that the CLI and
 * supervisor bundles landed.
 */
export async function ensureDurableRuntime(
  overdeckHome: string,
  version: string,
  deps?: Partial<ConnectRuntimeDeps>,
): Promise<{ root: string; installed: boolean }> {
  const d = resolveDeps(deps);
  const root = runtimePackageRoot(overdeckHome);
  if ((await readRuntimeVersion(overdeckHome, d)) === version) return { root, installed: false };

  const prefix = runtimePrefix(overdeckHome);
  const args = ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--omit=dev', `@overdeck/core@${version}`];
  try {
    await d.execFile('npm', args, { timeout: NPM_INSTALL_TIMEOUT_MS });
  } catch (error) {
    const { stderr, message } = error as { stderr?: unknown; message?: string };
    const detail = typeof stderr === 'string' && stderr.trim() ? lastLines(stderr, NPM_STDERR_LINES) : (message ?? String(error));
    throw new Error(
      `Could not install @overdeck/core@${version} into ${prefix}: ${detail}. Run that npm command yourself, then run pan connect again.`,
    );
  }

  for (const file of REQUIRED_FILES) {
    if (!(await d.fileExists(join(root, file)))) {
      throw new Error(`Installed @overdeck/core@${version} into ${prefix}, but ${file} is missing from ${root}.`);
    }
  }
  return { root, installed: true };
}
