/**
 * The Herdr session server for this Overdeck home (PAN-3956 W7, D6).
 *
 * One headless `herdr --session <session> server` per Overdeck home. On a
 * systemd host it runs as the user unit `<session>-herdr.service`
 * (`overdeck-herdr.service` for the default home); elsewhere it is spawned
 * detached with its output in `~/.overdeck/logs/herdr-<session>.log`.
 *
 * Nothing here ever stops or restarts a server: a restart closes every agent
 * pane. A server that is already running is left alone — the unit is only
 * installed and enabled so a reboot brings it back.
 */

import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { defaultHerdrExec, readHerdrStatus, type HerdrExec } from './status.js';

export const HERDR_SERVER_WAIT_MS = 10_000;
export const HERDR_SERVER_POLL_MS = 250;

/** `overdeck-herdr.service` for the default home. */
export function herdrUnitName(session: string): string {
  return `${session}-herdr.service`;
}

function systemdQuote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
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

async function defaultSpawnDetached(binary: string, args: readonly string[], logPath: string): Promise<void> {
  await mkdir(join(logPath, '..'), { recursive: true });
  const log = await open(logPath, 'a');
  try {
    const child = spawn(binary, [...args], { detached: true, stdio: ['ignore', log.fd, log.fd] });
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
}

export interface EnsureHerdrServerResult {
  readonly running: boolean;
  readonly managedBy?: 'systemd' | 'detached' | 'already-running';
  readonly unit?: string;
  readonly reason?: string;
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

  const onSystemd = await systemd.available().catch(() => false);

  if (await answering()) {
    if (!onSystemd) return { running: true, managedBy: 'already-running' };
    // Keep the unit current and enabled so a reboot brings the server back —
    // plain `enable`: a server started outside the unit must not get a twin.
    await systemd.installUserUnit(unit, renderHerdrUnit(deps.binary, deps.session));
    await systemd.enableUserUnit(unit);
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
