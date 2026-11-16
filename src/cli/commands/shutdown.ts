/**
 * `pan shutdown` (PAN-5342): drain Overdeck safely.
 *
 * The drain itself runs in the dashboard (it owns the runtime mirror, D-5).
 * This verb starts, follows, forces, cancels or prints it through
 * `/api/shutdown`. `--finish` is the detached final stage the drain starts
 * once every session has stopped: it runs the `pan down` teardown and reboots
 * when asked.
 *
 * Invoked from inside a managed session, the verb starts the drain and exits
 * at once (D-15): waiting would keep its own Bash call in flight, and that
 * session would never reach a turn boundary.
 */

import type { ShutdownPendingSession, ShutdownSnapshot, ShutdownWriter } from '@overdeck/contracts';
import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';

export interface ShutdownOptions {
  deadline?: string;
  reboot?: boolean;
  force?: boolean;
  cancel?: boolean;
  status?: boolean;
  /** Commander's `--no-wait`: false when the flag is passed. */
  wait?: boolean;
  finish?: boolean;
}

type CallDashboard = (
  path: string,
  init: { method: string; body?: unknown },
) => Promise<Response>;

export interface ShutdownDeps {
  callDashboard: CallDashboard;
  sleep: (ms: number) => Promise<void>;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  downCommand: (options: { skipTraefik?: boolean }) => Promise<void>;
  execFile: (file: string, args: string[], options?: { timeout?: number }) => Promise<unknown>;
  platform: NodeJS.Platform;
  now: () => number;
  /** The local shutdown record's phase, read once the dashboard stops answering mid-follow. */
  readRecordPhase: () => Promise<string | null>;
}

export const SHUTDOWN_POLL_MS = 2_000;
export const FINISH_DELAY_MS = 1_500;
export const DASHBOARD_DOWN_TEXT = 'The dashboard is not running. Start it with `pan up`, then run `pan shutdown`.';
export const STARTED_TEXT = 'Shutdown started. Follow it in the dashboard banner or with `pan shutdown --status`.';
const FOLLOW_ELSEWHERE_TEXT = 'Follow it in the dashboard banner or with `pan shutdown --status`.';
export const OVERDUE_HINT = 'Nothing is stopped mid-tool. Run `pan shutdown --force` to stop them, or `pan shutdown --cancel`.';

const MIN_DEADLINE_SECONDS = 10;
const MAX_DEADLINE_SECONDS = 3600;

function defaultDeps(): ShutdownDeps {
  return {
    callDashboard: (path, init) => callDashboard(path, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    env: process.env,
    log: (line) => console.log(line),
    downCommand: async (options) => (await import('./down.js')).downCommand(options),
    execFile: async (file, args, options) => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      return promisify(execFile)(file, args, options ?? {});
    },
    platform: process.platform,
    now: () => Date.now(),
    readRecordPhase: async () => (await (await import('../../lib/shutdown/drain-record.js')).readShutdownRecord())?.phase ?? null,
  };
}

/** Commander passes its Command object as the second argument; only real dep keys override the defaults. */
function resolveDeps(overrides: Partial<ShutdownDeps> | undefined): ShutdownDeps {
  const defaults = defaultDeps();
  const given = overrides ?? {};
  return {
    callDashboard: given.callDashboard ?? defaults.callDashboard,
    sleep: given.sleep ?? defaults.sleep,
    env: given.env ?? defaults.env,
    log: given.log ?? defaults.log,
    downCommand: given.downCommand ?? defaults.downCommand,
    execFile: given.execFile ?? defaults.execFile,
    platform: given.platform ?? defaults.platform,
    now: given.now ?? defaults.now,
    readRecordPhase: given.readRecordPhase ?? defaults.readRecordPhase,
  };
}

function seconds(ms: number): number {
  return Math.max(0, Math.round(ms / 1000));
}

function timeLeft(snapshot: ShutdownSnapshot, now: number): string {
  const ms = Date.parse(snapshot.deadlineAt) - now;
  if (Number.isNaN(ms)) return 'no deadline';
  return ms >= 0 ? `${seconds(ms)}s left` : `overdue by ${seconds(-ms)}s`;
}

export function pendingLine(session: ShutdownPendingSession, now: number): string {
  if (!session.tool) return `  ${session.id}: ${session.activity}`;
  const description = session.toolDescription ? ` (${session.toolDescription})` : '';
  const started = session.toolStartedAt ? Date.parse(session.toolStartedAt) : Number.NaN;
  const age = Number.isNaN(started) ? '' : `, ${seconds(now - started)}s`;
  return `  ${session.id}: ${session.tool}${description}${age}`;
}

function writerLine(writer: ShutdownWriter, now: number): string {
  const started = writer.startedAt ? Date.parse(writer.startedAt) : Number.NaN;
  const age = Number.isNaN(started) ? '' : `, ${seconds(now - started)}s`;
  return `  ${writer.kind}: ${writer.label}${age}`;
}

function stragglerLines(snapshot: ShutdownSnapshot, now: number): string[] {
  return [
    ...snapshot.pending.map((session) => pendingLine(session, now)),
    ...snapshot.writers.map((writer) => writerLine(writer, now)),
  ];
}

export function statusLines(snapshot: ShutdownSnapshot, now: number): string[] {
  const lines = [`Shutdown ${snapshot.phase}: ${timeLeft(snapshot, now)}, ${snapshot.stoppedCount} stopped${snapshot.reboot ? ', reboot when done' : ''}`];
  if (snapshot.pending.length > 0) {
    lines.push(`Pending sessions (${snapshot.pending.length}):`, ...snapshot.pending.map((session) => pendingLine(session, now)));
  }
  if (snapshot.writers.length > 0) {
    lines.push(`Pending writers (${snapshot.writers.length}):`, ...snapshot.writers.map((writer) => writerLine(writer, now)));
  }
  for (const warning of snapshot.warnings) lines.push(`Warning: ${warning}`);
  return lines;
}

function progressLine(snapshot: ShutdownSnapshot): string {
  return `Shutdown ${snapshot.phase}: ${snapshot.pending.length} session(s) pending, ${snapshot.writers.length} writer(s), ${snapshot.stoppedCount} stopped`;
}

async function readSnapshot(deps: ShutdownDeps): Promise<{ ok: true; shutdown: ShutdownSnapshot | null } | { ok: false; error: string }> {
  const response = await deps.callDashboard('/api/shutdown', { method: 'GET' });
  if (!response.ok) return { ok: false, error: await errorText(response) };
  const body = await response.json() as { shutdown?: ShutdownSnapshot | null };
  return { ok: true, shutdown: body.shutdown ?? null };
}

function parseDeadline(raw: string | undefined): number | undefined | 'invalid' {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_DEADLINE_SECONDS || value > MAX_DEADLINE_SECONDS) return 'invalid';
  return value;
}

async function finish(options: ShutdownOptions, deps: ShutdownDeps): Promise<number> {
  // Give the dashboard a moment to emit `complete` before it stops.
  await deps.sleep(FINISH_DELAY_MS);
  await deps.downCommand({});
  if (options.reboot && deps.platform === 'linux') {
    deps.log('Overdeck is shut down. Rebooting…');
    await deps.execFile('systemctl', ['reboot'], { timeout: 30_000 });
    return 0;
  }
  deps.log('Overdeck is shut down. It is safe to reboot.');
  return 0;
}

async function status(deps: ShutdownDeps): Promise<number> {
  const result = await readSnapshot(deps);
  if (!result.ok) {
    deps.log(result.error);
    return 1;
  }
  if (!result.shutdown) {
    deps.log('No shutdown is running.');
    return 0;
  }
  for (const line of statusLines(result.shutdown, deps.now())) deps.log(line);
  return 0;
}

async function cancel(deps: ShutdownDeps): Promise<number> {
  const response = await deps.callDashboard('/api/shutdown/cancel', { method: 'POST' });
  if (!response.ok) {
    deps.log(await errorText(response));
    return 1;
  }
  deps.log('Shutdown cancelled. Stopped sessions are offered under Needs you.');
  return 0;
}

/** Poll until `complete` (exit 0) or the drain disappears (exit 1). Prints only on change. */
async function follow(first: ShutdownSnapshot, deps: ShutdownDeps): Promise<number> {
  let snapshot: ShutdownSnapshot | null = first;
  let lastProgress = '';
  let overduePrinted = false;
  for (;;) {
    if (!snapshot) {
      deps.log('The shutdown was cancelled.');
      return 1;
    }
    if (snapshot.phase === 'complete') {
      for (const warning of snapshot.warnings) deps.log(`Warning: ${warning}`);
      deps.log(snapshot.reboot ? 'Rebooting…' : 'Safe to reboot.');
      return 0;
    }
    const progress = progressLine(snapshot);
    if (progress !== lastProgress) {
      deps.log(progress);
      lastProgress = progress;
    }
    if (snapshot.overdue && !overduePrinted) {
      overduePrinted = true;
      deps.log('The deadline has passed. Still pending:');
      for (const line of stragglerLines(snapshot, deps.now())) deps.log(line);
      if (snapshot.force === 'never') deps.log(OVERDUE_HINT);
    }
    await deps.sleep(SHUTDOWN_POLL_MS);
    let result: Awaited<ReturnType<typeof readSnapshot>>;
    try {
      result = await readSnapshot(deps);
    } catch (error) {
      if (!isDashboardUnreachable(error)) throw error;
      // The final stage stops the dashboard right after `complete`; a poll can miss
      // that snapshot. The record on disk carries the phase the drain reached.
      if (await deps.readRecordPhase() === 'complete') {
        deps.log(snapshot.reboot ? 'Rebooting…' : 'Safe to reboot.');
        return 0;
      }
      deps.log('The dashboard stopped answering before the drain completed. Run `pan up`, then `pan shutdown --status`.');
      return 1;
    }
    if (!result.ok) {
      deps.log(result.error);
      return 1;
    }
    snapshot = result.shutdown;
  }
}

async function start(options: ShutdownOptions, deps: ShutdownDeps): Promise<number> {
  const deadlineSeconds = parseDeadline(options.deadline);
  if (deadlineSeconds === 'invalid') {
    deps.log(`--deadline must be a whole number of seconds from ${MIN_DEADLINE_SECONDS} to ${MAX_DEADLINE_SECONDS}.`);
    return 1;
  }
  const inSession = Boolean(deps.env.OVERDECK_AGENT_ID || deps.env.OVERDECK_CONVERSATION);
  const detach = inSession || options.wait === false;

  const current = await readSnapshot(deps);
  if (!current.ok) {
    deps.log(current.error);
    return 1;
  }

  let snapshot: ShutdownSnapshot;
  const alreadyRunning = current.shutdown !== null;
  if (current.shutdown) {
    snapshot = current.shutdown;
    if (options.force) {
      const forced = await deps.callDashboard('/api/shutdown/force-all', { method: 'POST' });
      if (!forced.ok) {
        deps.log(await errorText(forced));
        return 1;
      }
      deps.log('A shutdown is already running. Its pending sessions are being stopped now.');
    } else {
      deps.log('A shutdown is already running.');
    }
  } else {
    const body: { deadlineSeconds?: number; reboot: boolean; force: boolean } = {
      reboot: Boolean(options.reboot),
      force: Boolean(options.force),
    };
    if (deadlineSeconds !== undefined) body.deadlineSeconds = deadlineSeconds;
    const response = await deps.callDashboard('/api/shutdown', { method: 'POST', body });
    if (!response.ok) {
      deps.log(await errorText(response));
      return 1;
    }
    snapshot = (await response.json() as { shutdown: ShutdownSnapshot }).shutdown;
  }

  if (detach) {
    deps.log(alreadyRunning ? FOLLOW_ELSEWHERE_TEXT : STARTED_TEXT);
    return 0;
  }
  return follow(snapshot, deps);
}

export async function shutdownCommand(options: ShutdownOptions, overrides?: Partial<ShutdownDeps>): Promise<void> {
  const deps = resolveDeps(overrides);
  let code: number;
  try {
    if (options.finish) code = await finish(options, deps);
    else if (options.status) code = await status(deps);
    else if (options.cancel) code = await cancel(deps);
    else code = await start(options, deps);
  } catch (error) {
    if (!isDashboardUnreachable(error)) throw error;
    deps.log(DASHBOARD_DOWN_TEXT);
    code = 1;
  }
  if (code !== 0) process.exitCode = code;
}
