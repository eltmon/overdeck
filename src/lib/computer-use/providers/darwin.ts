/**
 * The macOS computer-use provider (PAN-5463, PRD WI-3, FR-1, FR-3, D-9).
 *
 * Wraps the macOS modules behind PAN-5461's ComputerUseProvider seam:
 * macos-install.ts installs the helper app, macos-daemon.ts talks to the
 * helper daemon, and macos-protocol.ts maps operations both ways. Types come
 * from ../platform-types.js, never ../platform.js, because platform.ts imports
 * this file (D-10).
 *
 * The readiness `session` is ok on macOS 14+ even before the helper is
 * installed, because setup refuses to run any step without a session and its
 * first step installs the helper. `resolveSession` (what `pan computer` uses)
 * additionally requires the installed helper.
 *
 * Permission status comes from launching the installed helper with
 * `--permission-status-file` through LaunchServices, so macOS checks the
 * helper's own grants rather than the caller's (Orca's method, D-18).
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { release } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { holderKey as holderKeyReal, tryWithDesktopLock as tryWithDesktopLockReal, withDesktopLock as withDesktopLockReal } from '../lease.js';
import { request as daemonRequestReal } from '../macos-daemon.js';
import {
  installedHelperDir,
  installedHelperPath,
  installHelper as installHelperReal,
  isInstalledCurrent as isInstalledCurrentReal,
  type InstallResult,
  type MacosExecFileFn,
} from '../macos-install.js';
import { fromMacResponse, toMacRequest } from '../macos-protocol.js';
import type { ComputerUseProvider, ReadinessCheck, SetupStep, SetupStepResult } from '../platform-types.js';

const execFileAsync = promisify(execFile);

const OPEN = '/usr/bin/open';
const MIN_DARWIN_MAJOR = 23; // macOS 14 Sonoma
const STATUS_POLL_ATTEMPTS = 50;
const STATUS_POLL_MS = 100;
const HANDSHAKE_IF_FREE_WAIT_MS = 2_000;

export const WAITING_MESSAGE = 'Switch on "Overdeck Computer Use" in the two System Settings pages that opened, then press Continue.';
const NEEDS_MACOS_14 = 'Computer use on macOS needs macOS 14 or newer.';
const NOT_INSTALLED = 'The Overdeck Computer Use helper is not installed. Run setup in Settings → Computer Use.';

export type PermissionState = 'granted' | 'not-granted';
export interface PermissionStatus {
  accessibility: PermissionState;
  /** Screen Recording; the helper calls it "screenshots". */
  screenshots: PermissionState;
}

export type PermissionPaneId = 'accessibility' | 'screen-recording';

export interface DarwinProviderDeps {
  osRelease?: () => string;
  productVersion?: () => Promise<string | null>;
  execFile?: MacosExecFileFn;
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  rm?: (path: string, options: { force: true }) => Promise<void>;
  pathExists?: (path: string) => Promise<boolean>;
  randomUUID?: () => string;
  sleep?: (ms: number) => Promise<void>;
  helperAppPath?: () => string;
  isInstalledCurrent?: () => Promise<boolean>;
  installHelper?: () => Promise<InstallResult>;
  request?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  holderKey?: () => string;
  withDesktopLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  tryWithDesktopLock?: <T>(fn: () => Promise<T>, options: { waitMs: number }) => Promise<{ acquired: true; value: T } | { acquired: false }>;
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPermissionState(value: unknown): value is PermissionState {
  return value === 'granted' || value === 'not-granted';
}

export function createDarwinProvider(deps: DarwinProviderDeps = {}): ComputerUseProvider & {
  readPermissionStatus(): Promise<PermissionStatus | null>;
  openPermissionPane(id: PermissionPaneId): Promise<void>;
} {
  const exec: MacosExecFileFn = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options ?? {}));
  const osRelease = deps.osRelease ?? release;
  const pathExists = deps.pathExists ?? defaultPathExists;
  const appPath = deps.helperAppPath ?? installedHelperPath;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const daemonRequest = deps.request ?? ((method: string, params?: Record<string, unknown>) => daemonRequestReal(method, params));
  const withDesktopLock = deps.withDesktopLock ?? (<T>(fn: () => Promise<T>) => withDesktopLockReal(fn));
  const tryWithDesktopLock =
    deps.tryWithDesktopLock ?? (<T>(fn: () => Promise<T>, options: { waitMs: number }) => tryWithDesktopLockReal(fn, options));
  const productVersion =
    deps.productVersion ??
    (async () => {
      try {
        return (await exec('/usr/bin/sw_vers', ['-productVersion'], { timeout: 5_000 })).stdout.trim() || null;
      } catch {
        return null;
      }
    });

  const supportedMacos = () => Number.parseInt(osRelease().split('.')[0] ?? '', 10) >= MIN_DARWIN_MAJOR;
  const sessionLabel = async () => `macOS ${(await productVersion()) ?? `(Darwin ${osRelease()})`}`;

  /** Launches the helper with --permission-status-file and polls the file 50 × 100 ms (FR-3, D-18). */
  async function readPermissionStatus(): Promise<PermissionStatus | null> {
    const file = join(installedHelperDir(), `permission-status-${(deps.randomUUID ?? randomUUID)()}.json`);
    const read = deps.readFile ?? ((path: string, encoding: 'utf8') => readFile(path, encoding));
    try {
      await exec(OPEN, ['-n', '-g', '-a', appPath(), '--args', '--permission-status-file', file], { timeout: 10_000 });
      for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt++) {
        await sleep(STATUS_POLL_MS);
        let text: string;
        try {
          text = await read(file, 'utf8');
        } catch {
          continue;
        }
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (isPermissionState(parsed.accessibility) && isPermissionState(parsed.screenshots)) {
          return { accessibility: parsed.accessibility, screenshots: parsed.screenshots };
        }
        return null;
      }
      return null;
    } catch {
      return null;
    } finally {
      await (deps.rm ?? ((path: string, options: { force: true }) => rm(path, options)))(file, { force: true });
    }
  }

  async function openPermissionPane(id: PermissionPaneId): Promise<void> {
    await exec(OPEN, ['-n', '-a', appPath(), '--args', '--permission', id === 'accessibility' ? 'accessibility' : 'screenshots'], {
      timeout: 10_000,
    });
  }

  async function handshakeRow(probeHelper: 'wait' | 'if-free'): Promise<ReadinessCheck> {
    const label = 'Helper handshake';
    try {
      const handshake = () => daemonRequest('handshake', {});
      if (probeHelper === 'wait') {
        await withDesktopLock(handshake);
      } else {
        const result = await tryWithDesktopLock(handshake, { waitMs: HANDSHAKE_IF_FREE_WAIT_MS });
        if (!result.acquired) return { id: 'handshake', label, status: 'ok', detail: 'Skipped: an agent is using the desktop' };
      }
      return { id: 'handshake', label, status: 'ok', detail: 'Handshake ok' };
    } catch (error) {
      return { id: 'handshake', label, status: 'missing', detail: `Handshake failed: ${errorMessage(error)}` };
    }
  }

  function permissionRow(id: 'accessibility' | 'screen-recording', label: string, state: PermissionState | 'unknown'): ReadinessCheck {
    if (state === 'granted') return { id, label, status: 'ok', detail: 'Allowed' };
    if (state === 'not-granted') return { id, label, status: 'action', detail: 'Not allowed' };
    return { id, label, status: 'unavailable', detail: 'Could not read permission status' };
  }

  return {
    id: 'darwin',
    blockedKeyPlatform: 'mac',
    readPermissionStatus,
    openPermissionPane,

    async resolveSession() {
      if (!supportedMacos()) return { ok: false, code: 'no_desktop_session', message: NEEDS_MACOS_14 };
      if (!(await pathExists(appPath()))) return { ok: false, code: 'no_desktop_session', message: NOT_INSTALLED };
      return { ok: true, session: { label: await sessionLabel(), env: process.env } };
    },

    async readiness({ probeHelper }) {
      if (!supportedMacos()) {
        return {
          session: { ok: false, message: NEEDS_MACOS_14 },
          checks: [{ id: 'macos-version', label: 'macOS version', status: 'unavailable', detail: `${NEEDS_MACOS_14} This Mac runs Darwin ${osRelease()}.` }],
          setupSteps: [],
        };
      }
      const label = await sessionLabel();
      const checks: ReadinessCheck[] = [{ id: 'macos-version', label: 'macOS version', status: 'ok', detail: label }];
      const setupSteps: SetupStep[] = [];

      const installed = await pathExists(appPath());
      const current = installed && (await (deps.isInstalledCurrent ?? (() => isInstalledCurrentReal()))());
      checks.push(
        current
          ? { id: 'helper', label: 'Overdeck Computer Use helper', status: 'ok', detail: 'Installed' }
          : installed
            ? { id: 'helper', label: 'Overdeck Computer Use helper', status: 'action', detail: 'An updated helper is ready to install' }
            : { id: 'helper', label: 'Overdeck Computer Use helper', status: 'missing', detail: 'Not installed' },
      );
      if (!current) setupSteps.push({ id: 'install-packages', label: 'Install the Overdeck Computer Use helper' });

      if (!installed) {
        const detail = 'Install the helper first';
        checks.push(
          { id: 'accessibility', label: 'Accessibility', status: 'unavailable', detail },
          { id: 'screen-recording', label: 'Screen Recording', status: 'unavailable', detail },
          { id: 'handshake', label: 'Helper handshake', status: 'unavailable', detail },
        );
        setupSteps.push({ id: 'grant-permissions', label: 'Allow Accessibility and Screen Recording' });
        return { session: { ok: true, label }, checks, setupSteps };
      }

      const permissions = await readPermissionStatus();
      checks.push(
        permissionRow('accessibility', 'Accessibility', permissions?.accessibility ?? 'unknown'),
        permissionRow('screen-recording', 'Screen Recording', permissions?.screenshots ?? 'unknown'),
      );
      if (permissions?.accessibility !== 'granted' || permissions.screenshots !== 'granted') {
        setupSteps.push({ id: 'grant-permissions', label: 'Allow Accessibility and Screen Recording' });
      }
      checks.push(await handshakeRow(probeHelper));
      return { session: { ok: true, label }, checks, setupSteps };
    },

    async runSetupStep(id): Promise<SetupStepResult> {
      if (id === 'install-packages') {
        const { status } = await (deps.installHelper ?? (() => installHelperReal()))();
        if (status === 'current') return { status: 'skipped' };
        return status === 'updated'
          ? { status: 'done', message: 'Updated the helper. macOS asks you to allow the updated helper again.' }
          : { status: 'done' };
      }
      if (id === 'grant-permissions') {
        const permissions = await readPermissionStatus();
        if (permissions?.accessibility === 'granted' && permissions.screenshots === 'granted') return { status: 'done' };
        await exec(OPEN, ['-n', '-a', appPath(), '--args', '--permissions'], { timeout: 10_000 });
        return { status: 'waiting', message: WAITING_MESSAGE };
      }
      return { status: 'skipped' };
    },

    async runHelper(operation) {
      const request = toMacRequest(operation, (deps.holderKey ?? (() => holderKeyReal()))());
      const result = await daemonRequest(request.method, request.params);
      return fromMacResponse(request.method, result, request);
    },
  };
}

export const darwinProvider = createDarwinProvider();

/** Opens the helper's permission window on one pane (WI-5 route); not part of the provider seam. */
export function openPermissionPane(id: PermissionPaneId): Promise<void> {
  return darwinProvider.openPermissionPane(id);
}
