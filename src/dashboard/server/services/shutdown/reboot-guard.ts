/**
 * Reboot guard (PAN-5342, WI-8, D-13, FR-11).
 *
 * While at least one session is mid-turn, the dashboard holds a logind block
 * inhibitor so a plain reboot does not SIGKILL agents mid-tool:
 *   systemd-inhibit --what=shutdown --mode=block --who=Overdeck \
 *     --why="Overdeck has N agents running. Use Shut down Overdeck first." cat
 * with stdin piped. Ending stdin (or the dashboard dying, which closes the
 * pipe) makes `cat` exit and releases the lock, so a stale lock is impossible.
 *
 * - N counts live sessions (the drain's own census, `listLiveSessionIds`) that
 *   are NOT at a turn boundary (`isSessionAtTurnBoundary`, the id form). Live
 *   idle sessions never hold it (epic-owner decision, 2026-11-15). A session
 *   with no runtime snapshot is unknown, so it counts as mid-turn.
 * - An unreadable inventory (`null`) keeps the current state.
 * - The first tick runs one `REBOOT_GUARD_TICK_MS` after start: at boot the
 *   runtime mirror is not seeded yet and every session would read mid-turn.
 * - While a drain runs (the shutdown record exists), N = 0 does not release:
 *   the guard is held through the whole drain (glossary, D-13) until the drain
 *   calls `releaseRebootGuard()` on entering `complete`. That latch is final:
 *   no tick runs after it.
 * - A spawn `error` (ENOENT) or a non-zero exit within 2 s disables the guard
 *   for this process, logged once.
 * - Linux only; a no-op elsewhere. No sync child processes (NFR-1).
 */
import { spawn as nodeSpawn } from 'node:child_process';

import { isSessionAtTurnBoundary } from '../../../../lib/agents/liveness.js';
import { isShutdownDrainingSync } from '../../../../lib/shutdown/drain-record.js';
import { listLiveSessionIds } from './preview.js';

export const REBOOT_GUARD_TICK_MS = 30_000;
const EARLY_EXIT_MS = 2_000;

/** The slice of a child process the guard uses. */
export interface InhibitorProcess {
  readonly stdin: { end(): void; on(event: 'error', listener: (err: Error) => void): unknown } | null;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export interface RebootGuardDeps {
  readonly platform: NodeJS.Platform;
  readonly spawn: (command: string, args: readonly string[], options: { stdio: ['pipe', 'ignore', 'ignore'] }) => InhibitorProcess;
  readonly listLiveSessionIds: () => Promise<ReadonlySet<string> | null>;
  readonly atTurnBoundary: (id: string) => boolean;
  readonly isDraining: () => boolean;
  readonly now: () => number;
}

const defaultRebootGuardDeps: RebootGuardDeps = {
  platform: process.platform,
  spawn: (command, args, options) => nodeSpawn(command, [...args], options),
  listLiveSessionIds: () => listLiveSessionIds(),
  atTurnBoundary: isSessionAtTurnBoundary,
  isDraining: isShutdownDrainingSync,
  now: Date.now,
};

export function rebootGuardArgs(n: number): string[] {
  return [
    '--what=shutdown',
    '--mode=block',
    '--who=Overdeck',
    `--why=Overdeck has ${n} agents running. Use Shut down Overdeck first.`,
    'cat',
  ];
}

let deps: RebootGuardDeps = defaultRebootGuardDeps;
let timer: ReturnType<typeof setInterval> | null = null;
let child: InhibitorProcess | null = null;
let heldCount = 0;
let released = false;
let disabled = false;
let ticking = false;

function endChild(proc: InhibitorProcess | null): void {
  try {
    proc?.stdin?.end();
  } catch {
    // The pipe is already gone; the lock went with it.
  }
}

function stopTicking(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function disable(reason: string): void {
  if (!disabled) console.warn(`[reboot-guard] disabled: ${reason}`);
  disabled = true;
  stopTicking();
  endChild(child);
  child = null;
  heldCount = 0;
}

function hold(n: number): void {
  const previous = child;
  const spawnedAt = deps.now();
  let next: InhibitorProcess;
  try {
    next = deps.spawn('systemd-inhibit', rebootGuardArgs(n), { stdio: ['pipe', 'ignore', 'ignore'] });
  } catch (err) {
    disable(err instanceof Error ? err.message : String(err));
    return;
  }
  // An EPIPE on a pipe whose reader died must never become an unhandled error.
  next.stdin?.on('error', () => undefined);
  next.on('error', (err) => {
    if (child === next) disable(err.message);
  });
  next.on('exit', (code) => {
    if (child !== next) return;
    if (code !== 0 && code !== null && deps.now() - spawnedAt < EARLY_EXIT_MS) {
      disable(`systemd-inhibit exited with code ${code}`);
      return;
    }
    child = null; // The lock is gone; the next tick takes it again if still needed.
    heldCount = 0;
  });
  child = next;
  heldCount = n;
  endChild(previous); // New holder first, then the old one: no gap in the lock.
}

async function tick(): Promise<void> {
  if (released || disabled || ticking) return;
  ticking = true;
  try {
    const live = await deps.listLiveSessionIds().catch(() => null);
    if (live === null || released || disabled) return;
    const n = [...live].filter((id) => {
      try {
        return !deps.atTurnBoundary(id);
      } catch {
        return true;
      }
    }).length;
    if (n === 0) {
      if (deps.isDraining()) return;
      endChild(child);
      child = null;
      heldCount = 0;
      return;
    }
    if (child === null || n !== heldCount) hold(n);
  } finally {
    ticking = false;
  }
}

export function startRebootGuard(overrides: Partial<RebootGuardDeps> = {}): void {
  deps = { ...defaultRebootGuardDeps, ...overrides };
  if (deps.platform !== 'linux' || timer || released || disabled) return;
  timer = setInterval(() => void tick(), REBOOT_GUARD_TICK_MS);
  timer.unref?.();
}

/** Called by the drain on entering `complete` (D-13). Final for this process. */
export function releaseRebootGuard(): void {
  released = true;
  stopTicking();
  endChild(child);
  child = null;
  heldCount = 0;
}

export function _resetRebootGuardForTests(): void {
  stopTicking();
  deps = defaultRebootGuardDeps;
  child = null;
  heldCount = 0;
  released = false;
  disabled = false;
  ticking = false;
}
