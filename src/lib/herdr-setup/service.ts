/**
 * The Herdr session server for this Overdeck home (PAN-3956 W7, D6).
 *
 * One headless `herdr --session <session> server` per Overdeck home. For the
 * default home on a systemd host it runs as the user unit
 * `overdeck-herdr.service`. Any other home gets a boot-persistent unit only
 * with `OVERDECK_HERDR_PERSISTENT_UNIT=1`: a throwaway `OVERDECK_HOME` must
 * never leave a server that starts at every login. Everywhere else the server
 * is spawned fully detached (own session, re-parented away from the caller)
 * with its output in `~/.overdeck/logs/herdr-<session>.log`.
 *
 * Nothing here ever stops or restarts a server: a restart closes every agent
 * pane. A server that is already running is left alone — the unit is only
 * installed and enabled so a reboot brings it back.
 */

import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { DEFAULT_HERDR_SESSION_NAME } from '../terminal-backends/select.js';
import { defaultHerdrExec, readHerdrStatus, type HerdrExec } from './status.js';

export const HERDR_SERVER_WAIT_MS = 10_000;
export const HERDR_SERVER_POLL_MS = 250;

/** `overdeck-herdr.service` for the default home. */
export function herdrUnitName(session: string): string {
  return `${session}-herdr.service`;
}

/**
 * One ExecStart word. Quotes and backslashes are escaped; `%` (specifiers)
 * and `$` (variable expansion) are doubled so an odd install path is taken
 * literally.
 */
function systemdQuote(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '%%')
    .replaceAll('$', '$$$$');
  return `"${escaped}"`;
}

/**
 * Whether this session's server gets a boot-persistent user unit: the default
 * home always, any other home only on explicit opt-in
 * (`OVERDECK_HERDR_PERSISTENT_UNIT=1`). PAN-3956 review finding 6.
 */
export function herdrPersistentUnitWanted(
  session: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return session === DEFAULT_HERDR_SESSION_NAME || env.OVERDECK_HERDR_PERSISTENT_UNIT === '1';
}

/** The unit text. Matches the hand-written host unit except for the quoted absolute ExecStart. */
export function renderHerdrUnit(binary: string, session: string): string {
  return [
    '[Unit]',
    `Description=Herdr headless server for Overdeck (session: ${session})`,
    '',
    '[Service]',
    `ExecStart=${systemdQuote(binary)} --session ${session} server`,
    'Restart=on-failure',
    'RestartSec=3',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/** The systemd surface `ensureHerdrServer` needs — install, enable, query. No stop, no restart. */
export interface HerdrSystemd {
  available(): Promise<boolean>;
  installUserUnit(unitName: string, unitText: string): Promise<{ path: string; written: boolean }>;
  /** `systemctl --user enable` — start at login/boot, starts nothing now. */
  enableUserUnit(unitName: string): Promise<void>;
  /** `systemctl --user enable --now` — starts an inactive unit, never restarts an active one. */
  enableUserUnitNow(unitName: string): Promise<void>;
  isUserUnitActive(unitName: string): Promise<boolean>;
}

async function defaultSystemd(): Promise<HerdrSystemd> {
  const systemd = await import('../systemd.js');
  return {
    available: systemd.systemdUserAvailable,
    installUserUnit: (name, text) => systemd.installUserUnit(name, text),
    enableUserUnit: systemd.enableUserUnit,
    enableUserUnitNow: systemd.enableUserUnitNow,
    isUserUnitActive: systemd.isUserUnitActive,
  };
}

/** Log file for a detached (non-systemd) session server. */
export function herdrServerLogPath(session: string, overdeckHome: string = getOverdeckHome()): string {
  return join(overdeckHome, 'logs', `herdr-${session}.log`);
}

/**
 * Start the server so nothing that stops the caller can stop it. `detached`
 * gives the intermediate `sh` a new session and process group; `sh` then
 * backgrounds the server and exits at once, so the server is re-parented to
 * init (or the nearest subreaper) and is never a child of the dashboard, the
 * supervisor or `pan`. Stopping or restarting any of those leaves Herdr and
 * every agent pane alone (PAN-3956 review finding 7).
 */
export async function defaultSpawnDetached(
  binary: string,
  args: readonly string[],
  logPath: string,
  spawnImpl: typeof spawn = spawn,
): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const log = await open(logPath, 'a');
  try {
    const child = spawnImpl('/bin/sh', ['-c', '"$0" "$@" </dev/null &', binary, ...args], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    child.on('error', () => { /* surfaced by the socket wait */ });
    child.unref();
  } finally {
    await log.close();
  }
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface EnsureHerdrServerDeps {
  readonly binary: string;
  readonly session: string;
  readonly socket: string;
  readonly exec?: HerdrExec;
  readonly systemd?: HerdrSystemd;
  readonly spawnDetached?: (binary: string, args: readonly string[], logPath: string) => Promise<void>;
  readonly exists?: (path: string) => Promise<boolean>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly logPath?: string;
  /** Install and enable a boot-persistent unit. Defaults to `herdrPersistentUnitWanted(session)`. */
  readonly persistentUnit?: boolean;
}

export interface EnsureHerdrServerResult {
  readonly running: boolean;
  readonly managedBy?: 'systemd' | 'detached' | 'already-running';
  readonly unit?: string;
  readonly reason?: string;
  /** Unit upkeep that failed while the server itself is fine. */
  readonly warning?: string;
}

/**
 * Make sure this home's session server is running. Never stops or restarts
 * one. Waits up to 10 s for the socket to answer after starting it.
 */
export async function ensureHerdrServer(deps: EnsureHerdrServerDeps): Promise<EnsureHerdrServerResult> {
  const exec = deps.exec ?? defaultHerdrExec;
  const exists = deps.exists ?? defaultExists;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const systemd = deps.systemd ?? (await defaultSystemd());
  const unit = herdrUnitName(deps.session);
  const serverArgs = ['--session', deps.session, 'server'] as const;

  const answering = async (): Promise<boolean> =>
    (await exists(deps.socket)) && (await readHerdrStatus(deps.binary, deps.session, exec))?.server.running === true;

  const persistent = deps.persistentUnit ?? herdrPersistentUnitWanted(deps.session);
  const onSystemd = persistent && (await systemd.available().catch(() => false));

  if (await answering()) {
    if (!onSystemd) return { running: true, managedBy: 'already-running' };
    // Keep the unit current and enabled so a reboot brings the server back —
    // plain `enable`: a server started outside the unit must not get a twin.
    // Upkeep failures are warnings: the server itself is running.
    try {
      await systemd.installUserUnit(unit, renderHerdrUnit(deps.binary, deps.session));
      await systemd.enableUserUnit(unit);
    } catch (error) {
      return {
        running: true,
        managedBy: 'already-running',
        unit,
        warning: `Could not refresh or enable ${unit}: ${error instanceof Error ? error.message : String(error)}; `
          + 'the running server is unaffected, but it may not come back after a reboot',
      };
    }
    return { running: true, managedBy: 'already-running', unit };
  }

  let managedBy: 'systemd' | 'detached';
  if (onSystemd) {
    await systemd.installUserUnit(unit, renderHerdrUnit(deps.binary, deps.session));
    await systemd.enableUserUnitNow(unit);
    managedBy = 'systemd';
  } else {
    await (deps.spawnDetached ?? defaultSpawnDetached)(
      deps.binary,
      serverArgs,
      deps.logPath ?? herdrServerLogPath(deps.session),
    );
    managedBy = 'detached';
  }

  const deadline = now() + HERDR_SERVER_WAIT_MS;
  while (now() < deadline) {
    await sleep(HERDR_SERVER_POLL_MS);
    if (await answering()) {
      return { running: true, managedBy, ...(managedBy === 'systemd' ? { unit } : {}) };
    }
  }
  return {
    running: false,
    managedBy,
    ...(managedBy === 'systemd' ? { unit } : {}),
    reason: `session socket did not appear within ${HERDR_SERVER_WAIT_MS / 1000}s`,
  };
}
