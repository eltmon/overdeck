/**
 * The `herdr` binary: install, version, update, channel (PAN-3956 W5, D4, D5).
 *
 * Install path is the vendor installer (`https://herdr.dev/install.sh`) with
 * `HERDR_INSTALL_DIR=~/.local/bin` — the installer's own default. A binary that
 * lives anywhere else (brew, mise, nix) is someone else's to manage: Overdeck
 * verifies it but never changes its channel.
 *
 * Nothing here restarts the session server: `herdr update` replaces the binary
 * only; a running server keeps serving until an operator restarts it.
 */

import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { defaultHerdrExec, type HerdrExec, type HerdrStatus } from './status.js';

export const HERDR_INSTALL_URL = 'https://herdr.dev/install.sh';
export const HERDR_MANIFEST_URL = 'https://herdr.dev/latest.json';
/** Installer and `herdr update` download a release; give them room. */
const HERDR_INSTALL_TIMEOUT_MS = 120_000;
const HERDR_MANIFEST_TIMEOUT_MS = 10_000;

/** `~/.local/bin` — where the vendor installer puts `herdr`. */
export function herdrInstallDir(home: string = homedir()): string {
  return join(home, '.local', 'bin');
}

/** Numeric `a - b` over the first three dot-separated fields. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const da = Number.isFinite(pa[i]) ? (pa[i] as number) : 0;
    const db = Number.isFinite(pb[i]) ? (pb[i] as number) : 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** The first `X.Y.Z` in a version banner (`herdr 0.9.1` → `0.9.1`), or null. */
export function extractSemver(text: string | null | undefined): string | null {
  const match = text?.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

/** `herdr --version` → `"0.9.1"`; null when the binary cannot answer. */
export async function readHerdrVersion(
  binary: string,
  exec: HerdrExec = defaultHerdrExec,
): Promise<string | null> {
  try {
    const { stdout, exitCode } = await exec(binary, ['--version']);
    return exitCode === 0 ? extractSemver(stdout) : null;
  } catch {
    return null;
  }
}

/**
 * Latest stable version from the release manifest; null on any failure
 * (offline, timeout, bad JSON). An unreachable manifest is never an error.
 */
export async function fetchLatestStableVersion(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = HERDR_MANIFEST_TIMEOUT_MS,
): Promise<string | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolveTimeout) => {
    timer = setTimeout(() => {
      controller.abort();
      resolveTimeout(null);
    }, timeoutMs);
  });
  const request = (async (): Promise<string | null> => {
    const response = await fetchImpl(HERDR_MANIFEST_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === 'string' ? extractSemver(body.version) : null;
  })().catch(() => null);
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run the vendor installer into `~/.local/bin`. Throws when it fails. */
export async function installHerdrBinary(
  exec: HerdrExec = defaultHerdrExec,
  home: string = homedir(),
): Promise<{ binary: string }> {
  const installDir = herdrInstallDir(home);
  const result = await exec('sh', ['-c', `curl -fsSL ${HERDR_INSTALL_URL} | sh`], {
    env: { ...process.env, HERDR_INSTALL_DIR: installDir },
    timeoutMs: HERDR_INSTALL_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().split('\n').pop() ?? '';
    throw new Error(`Herdr installer exited ${result.exitCode}${detail ? `: ${detail}` : ''}`);
  }
  return { binary: join(installDir, 'herdr') };
}

/** `herdr update` (never `--handoff`). Replaces the binary; restarts nothing. */
export async function updateHerdrBinary(binary: string, exec: HerdrExec = defaultHerdrExec): Promise<void> {
  const result = await exec(binary, ['update'], { timeoutMs: HERDR_INSTALL_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().split('\n').pop() ?? '';
    throw new Error(`herdr update exited ${result.exitCode}${detail ? `: ${detail}` : ''}`);
  }
}

/** True when `binary` lives directly under the installer's directory. */
function isInstallerManaged(binary: string, home: string = homedir()): boolean {
  const dir = resolve(herdrInstallDir(home));
  return resolve(binary).startsWith(dir + sep);
}

/**
 * Keep an installer-managed binary on the stable channel. `unmanaged` for a
 * brew/mise/nix binary (verify-only); `changed` after `herdr channel set stable`.
 */
export async function ensureStableChannel(
  binary: string,
  status: HerdrStatus | null,
  exec: HerdrExec = defaultHerdrExec,
  home: string = homedir(),
): Promise<'stable' | 'changed' | 'unmanaged'> {
  if (!isInstallerManaged(binary, home)) return 'unmanaged';
  let channel = status?.client.channel;
  if (!channel || channel === 'unknown') {
    const shown = await exec(binary, ['channel', 'show']).catch(() => null);
    channel = shown && shown.exitCode === 0 ? shown.stdout.trim() : undefined;
  }
  if (channel === 'stable') return 'stable';
  const result = await exec(binary, ['channel', 'set', 'stable']);
  if (result.exitCode !== 0) {
    throw new Error(`herdr channel set stable exited ${result.exitCode}: ${(result.stderr || result.stdout).trim()}`);
  }
  return 'changed';
}
