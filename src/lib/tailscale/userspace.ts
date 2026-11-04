/**
 * Userspace Tailscale install (PAN-1254 W-3, FR-3, D-10, C-2).
 *
 * On Linux without an administrator password, Overdeck downloads the static
 * Tailscale tarball, installs `tailscale` and `tailscaled` under
 * `${OVERDECK_HOME}/tailscale/bin/`, and runs `tailscaled
 * --tun=userspace-networking` as this user under the systemd user unit
 * `overdeck-tailscaled.service`. Every failure returns the Linux installer
 * command as the fallback (the parent PRD's D-17 fallback).
 *
 * C-2: pkgs.tailscale.com publishes `<tarball>.sha256` (verified 2026-11-01 for
 * 1.104.4), so the checksum is required; a missing checksum fails the install
 * rather than trusting the download on HTTPS alone.
 *
 * Network, filesystem-extraction and systemd calls are injectable for tests.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getOverdeckHome } from '../paths.js';
import { enableUserUnitNow, installUserUnit, systemdUserAvailable } from '../systemd.js';
import { TAILSCALE_WRITE_TIMEOUT_MS } from './cli.js';
import { LINUX_INSTALL_COMMAND } from './installer.js';
import { invalidateTailscaleStateCache } from './state.js';

const execFileAsync = promisify(execFile);

export const USERSPACE_UNIT = 'overdeck-tailscaled.service';
/** tailscaled's outbound HTTP proxy; userspace mode has no TUN device (D-13). */
export const USERSPACE_HTTP_PROXY = '127.0.0.1:1055';
export const PACKAGES_URL = 'https://pkgs.tailscale.com/stable';
export const SOCKET_WAIT_MS = 10_000;
export const SOCKET_POLL_MS = 250;
const INDEX_TIMEOUT_MS = 15_000;
const TARBALL_TIMEOUT_MS = 180_000;

/** The D-10 unit. `overdeckHome` is `${OVERDECK_HOME}`. Pure. */
export function renderTailscaledUnit(overdeckHome: string): string {
  const root = join(overdeckHome, 'tailscale');
  return [
    '[Unit]',
    'Description=Overdeck userspace Tailscale',
    'After=network-online.target',
    '',
    '[Service]',
    `ExecStart=${root}/bin/tailscaled --tun=userspace-networking --statedir=${root}/state --socket=${root}/tailscaled.sock --outbound-http-proxy-listen=${USERSPACE_HTTP_PROXY}`,
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/** Node `process.arch` → the `Tarballs` key on pkgs.tailscale.com. */
export function tarballArch(nodeArch: string): string | null {
  switch (nodeArch) {
    case 'x64': return 'amd64';
    case 'arm64': return 'arm64';
    case 'arm': return 'arm';
    case 'ia32': return '386';
    default: return null;
  }
}

export type UserspaceFailureReason =
  | 'no-systemd'
  | 'unsupported-arch'
  | 'download-failed'
  | 'checksum-mismatch'
  | 'unit-failed'
  | 'daemon-timeout';

export type UserspaceResult =
  | { ok: true }
  | { ok: false; reason: UserspaceFailureReason; message: string; fallbackCommand: string };

export interface UserspaceDeps {
  overdeckHome?: string;
  arch?: string;
  systemdAvailable?: () => Promise<boolean>;
  fetch?: typeof fetch;
  /** Unpack `tarball` into `destDir`. */
  extract?: (tarball: string, destDir: string) => Promise<void>;
  installUnit?: (name: string, text: string) => Promise<unknown>;
  enableUnitNow?: (name: string) => Promise<void>;
  restartUnit?: (name: string) => Promise<void>;
  socketExists?: (path: string) => Promise<boolean>;
}

function fail(reason: UserspaceFailureReason, message: string): UserspaceResult {
  return { ok: false, reason, message, fallbackCommand: LINUX_INSTALL_COMMAND };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    // Read the body inside the timeout window.
    const body = await response.arrayBuffer();
    return new Response(body, { status: response.status });
  } finally {
    clearTimeout(timer);
  }
}

async function defaultExtract(tarball: string, destDir: string): Promise<void> {
  await execFileAsync('tar', ['-xzf', tarball, '-C', destDir]);
}

async function defaultRestartUnit(name: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAILSCALE_WRITE_TIMEOUT_MS);
  try {
    await execFileAsync('systemctl', ['--user', 'restart', name], { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForSocket(socketPath: string, socketExists: (path: string) => Promise<boolean>): Promise<boolean> {
  for (let waited = 0; ; waited += SOCKET_POLL_MS) {
    if (await socketExists(socketPath)) return true;
    if (waited >= SOCKET_WAIT_MS) return false;
    await new Promise((resolve) => setTimeout(resolve, SOCKET_POLL_MS));
  }
}

const DAEMON_TIMEOUT_MESSAGE = `Overdeck's tailscaled did not start within ${SOCKET_WAIT_MS / 1000} s. Check \`journalctl --user -u ${USERSPACE_UNIT}\`, or install Tailscale with the installer instead.`;

/** Download, verify and install the userspace binaries, then start the daemon unit. */
export async function installUserspaceTailscale(deps: UserspaceDeps = {}): Promise<UserspaceResult> {
  const overdeckHome = deps.overdeckHome ?? getOverdeckHome();
  const root = join(overdeckHome, 'tailscale');
  const fetchImpl = deps.fetch ?? fetch;

  if (!await (deps.systemdAvailable ?? systemdUserAvailable)()) {
    return fail('no-systemd', 'Userspace Tailscale needs systemd user services, which are not available here. Install Tailscale with the installer instead.');
  }
  const arch = tarballArch(deps.arch ?? process.arch);
  if (!arch) return fail('unsupported-arch', `Tailscale publishes no Linux tarball for ${deps.arch ?? process.arch}. Install Tailscale with the installer instead.`);

  let file: string;
  let tarball: Buffer;
  try {
    const index = await (await fetchWithTimeout(fetchImpl, `${PACKAGES_URL}/?mode=json`, INDEX_TIMEOUT_MS)).json() as { Tarballs?: Record<string, unknown> };
    const name = index.Tarballs?.[arch];
    if (typeof name !== 'string' || !/^tailscale_[\w.]+\.tgz$/.test(name)) {
      return fail('unsupported-arch', `Tailscale publishes no Linux tarball for ${arch}. Install Tailscale with the installer instead.`);
    }
    file = name;
    const [tarResponse, sumResponse] = await Promise.all([
      fetchWithTimeout(fetchImpl, `${PACKAGES_URL}/${file}`, TARBALL_TIMEOUT_MS),
      fetchWithTimeout(fetchImpl, `${PACKAGES_URL}/${file}.sha256`, INDEX_TIMEOUT_MS),
    ]);
    tarball = Buffer.from(await tarResponse.arrayBuffer());
    const expected = (await sumResponse.text()).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const actual = createHash('sha256').update(tarball).digest('hex');
    if (expected !== actual) {
      return fail('checksum-mismatch', `The downloaded ${file} does not match its published SHA-256 checksum, so Overdeck did not install it.`);
    }
  } catch (error) {
    return fail('download-failed', `Could not download Tailscale: ${errorMessage(error)}`);
  }

  const binDir = join(root, 'bin');
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    await mkdir(binDir, { recursive: true });
    await mkdir(join(root, 'state'), { recursive: true, mode: 0o700 });
    const workDir = await mkdtemp(join(root, '.download-'));
    try {
      const tarballPath = join(workDir, file);
      await writeFile(tarballPath, tarball);
      await (deps.extract ?? defaultExtract)(tarballPath, workDir);
      const unpacked = join(workDir, file.replace(/\.tgz$/, ''));
      for (const binary of ['tailscale', 'tailscaled']) {
        const staged = join(binDir, `.${binary}.new`);
        await copyFile(join(unpacked, binary), staged);
        await chmod(staged, 0o755);
        await rename(staged, join(binDir, binary));
      }
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  } catch (error) {
    return fail('download-failed', `Could not unpack Tailscale: ${errorMessage(error)}`);
  }

  try {
    await (deps.installUnit ?? installUserUnit)(USERSPACE_UNIT, renderTailscaledUnit(overdeckHome));
    await (deps.enableUnitNow ?? enableUserUnitNow)(USERSPACE_UNIT);
  } catch (error) {
    return fail('unit-failed', `Could not start ${USERSPACE_UNIT}: ${errorMessage(error)}`);
  } finally {
    invalidateTailscaleStateCache();
  }

  if (!await waitForSocket(join(root, 'tailscaled.sock'), deps.socketExists ?? pathExists)) {
    return fail('daemon-timeout', DAEMON_TIMEOUT_MESSAGE);
  }
  invalidateTailscaleStateCache();
  return { ok: true };
}

/** `systemctl --user restart overdeck-tailscaled.service`, then wait for the socket (D-8 start-daemon remedy). */
export async function restartUserspaceDaemon(deps: UserspaceDeps = {}): Promise<UserspaceResult> {
  const root = join(deps.overdeckHome ?? getOverdeckHome(), 'tailscale');
  try {
    await (deps.restartUnit ?? defaultRestartUnit)(USERSPACE_UNIT);
  } catch (error) {
    return fail('unit-failed', `Could not restart ${USERSPACE_UNIT}: ${errorMessage(error)}`);
  } finally {
    invalidateTailscaleStateCache();
  }
  if (!await waitForSocket(join(root, 'tailscaled.sock'), deps.socketExists ?? pathExists)) {
    return fail('daemon-timeout', DAEMON_TIMEOUT_MESSAGE);
  }
  invalidateTailscaleStateCache();
  return { ok: true };
}
