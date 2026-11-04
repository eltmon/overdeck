/**
 * Operator restart hold (PAN-5007) — a durable "do not restart the dashboard"
 * lock that every conversation sees.
 *
 * `pan restart hold --reason <text> [--until <when>]` writes
 * `~/.overdeck/restart-hold.json`; `pan restart release` deletes it. While it is
 * active, `pan reload`, `pan restart` (dashboard and full scope, `--now`
 * included) and every restart-gate approval refuse. An expired hold reads as
 * released, and reads never delete the file. A file that exists but cannot be
 * parsed (for example one a crash truncated) reads as an active hold: failing
 * open would let a restart through that the operator asked to stop.
 *
 * This is not the restart lock (`restart-lock.ts`): that lock is transient and
 * belongs to one live process, while the hold has no owner process and lasts
 * until somebody releases it or it expires.
 */

import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { getOverdeckHome } from './paths.js';

export interface RestartHold {
  reason: string;
  /** Who set the hold: the restart initiator, agent id, conversation, or OS user. */
  who: string;
  /** ISO time the hold was set. */
  setAt: string;
  /** ISO time the hold lapses on its own; absent means it lasts until released. */
  until?: string;
}

export function restartHoldPath(): string {
  return join(getOverdeckHome(), 'restart-hold.json');
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function parseHold(text: string): RestartHold | null {
  try {
    const parsed = JSON.parse(text) as Partial<RestartHold>;
    if (typeof parsed.reason !== 'string' || typeof parsed.who !== 'string' || typeof parsed.setAt !== 'string') {
      return null;
    }
    return {
      reason: parsed.reason,
      who: parsed.who,
      setAt: parsed.setAt,
      ...(typeof parsed.until === 'string' && parsed.until ? { until: parsed.until } : {}),
    };
  } catch {
    return null;
  }
}

/** True while `hold` has no expiry or its expiry is still in the future. */
export function isRestartHoldActive(hold: RestartHold, nowMs: number = Date.now()): boolean {
  if (!hold.until) return true;
  const until = Date.parse(hold.until);
  return !Number.isFinite(until) || until > nowMs;
}

/** The active hold, or null when there is none or it has expired. */
export async function readRestartHold(nowMs: number = Date.now()): Promise<RestartHold | null> {
  const path = restartHoldPath();
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null;
    throw error;
  }
  const hold = parseHold(text);
  if (!hold) {
    return {
      reason: `the hold file ${path} exists but cannot be read; check it, then run \`pan restart release\``,
      who: 'unknown',
      setAt: (await stat(path)).mtime.toISOString(),
    };
  }
  return isRestartHoldActive(hold, nowMs) ? hold : null;
}

/** The OS user, or a fixed label when the platform cannot name one. */
function osUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return 'unknown user';
  }
}

/**
 * Who is running this command: restart-status's `initiator` precedence, then
 * the conversation every harness exports, so a hold names the conversation
 * that set it.
 */
export function restartHoldActor(env: NodeJS.ProcessEnv = process.env): string {
  return env.OVERDECK_RESTART_INITIATOR || env.OVERDECK_AGENT_ID || env.OVERDECK_CONVERSATION || osUserName();
}

/** Write (or replace) the hold atomically with mode 0600. */
export async function writeRestartHold(hold: RestartHold): Promise<void> {
  const path = restartHoldPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(hold)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, path);
}

/** Delete the hold file. Returns the hold that was there (expired or not), or null when there was none. */
export async function releaseRestartHold(): Promise<RestartHold | null> {
  const path = restartHoldPath();
  let previous: RestartHold;
  try {
    previous = parseHold(await readFile(path, 'utf8'))
      ?? { reason: 'an unreadable hold file', who: 'unknown', setAt: (await stat(path)).mtime.toISOString() };
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
    return null;
  }
  try {
    await unlink(path);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
  }
  return previous;
}

const DURATION_UNITS_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/**
 * Parse `--until`: a duration such as `90m`, `2h` or `1d`, or an ISO date-time.
 * Returns the expiry as an ISO string; throws on anything else or on a time
 * that is not in the future.
 */
export function parseRestartHoldUntil(value: string, nowMs: number = Date.now()): string {
  const trimmed = value.trim();
  const duration = trimmed.match(/^(\d+)\s*([mhd])$/i);
  let untilMs: number;
  if (duration) {
    untilMs = nowMs + Number(duration[1]) * DURATION_UNITS_MS[duration[2].toLowerCase() as keyof typeof DURATION_UNITS_MS];
  } else if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    untilMs = Date.parse(trimmed);
  } else {
    untilMs = Number.NaN;
  }
  if (!Number.isFinite(untilMs)) {
    throw new Error(`--until must be a duration such as 90m, 2h or 1d, or an ISO time such as 2026-11-04T18:00:00Z; got "${value}"`);
  }
  if (untilMs <= nowMs) {
    throw new Error(`--until must be in the future; "${value}" is ${new Date(untilMs).toISOString()}`);
  }
  return new Date(untilMs).toISOString();
}

/** One line describing the hold: reason, setter, start and expiry. */
export function describeRestartHold(hold: RestartHold): string {
  const expiry = hold.until ? `until ${hold.until}` : 'until released';
  return `"${hold.reason}" — set by ${hold.who} at ${hold.setAt}, ${expiry}`;
}

/**
 * The refusal every held verb prints. It carries the release rule itself,
 * because most agents that hit it never read the skill docs.
 */
export function restartHoldRefusal(action: string, hold: RestartHold): string {
  return [
    `Refusing to ${action}: the operator restart hold is active (PAN-5007).`,
    `  Hold: ${describeRestartHold(hold)}.`,
    '  Nothing was built, approved or restarted. --now and --force do not bypass the hold.',
    '  Release it with `pan restart release`. Do not release a hold you did not set unless the operator asks you to.',
  ].join('\n');
}
