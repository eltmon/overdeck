// @vitest-environment node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireReloadLock,
  deleteOwnReloadSupersedeRequest,
  reloadSupersedeDetail,
  reloadSupersedeFile,
  writeReloadSupersedeRequest,
  RELOAD_SUPERSEDE_POLL_MS,
  type AcquireReloadLockDeps,
  type ReloadLockOutcome,
} from '../../../../src/lib/deploy/reload-supersede.js';
import type { RestartLockHandle, RestartLockHolder } from '../../../../src/lib/restart-lock.js';

const OWN_PID = 4242;
const OWN_SHA = 'b'.repeat(40);
const HOLDER_SHA = 'a'.repeat(40);

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;

const handle: RestartLockHandle = { refresh: async () => {}, release: async () => {} };

function reloadHolder(overrides: Partial<RestartLockHolder> = {}): RestartLockHolder {
  return { pid: 77, ts: Date.now(), caller: 'pan reload', targetSha: HOLDER_SHA, supersedable: true, ...overrides };
}

function deps(overrides: Partial<AcquireReloadLockDeps> = {}): AcquireReloadLockDeps & { log: ReturnType<typeof vi.fn> } {
  return {
    isAncestor: vi.fn(async () => false),
    acquire: vi.fn(async () => null),
    readHolder: vi.fn(async () => reloadHolder()),
    pid: OWN_PID,
    log: vi.fn(),
    ...overrides,
  } as AcquireReloadLockDeps & { log: ReturnType<typeof vi.fn> };
}

/**
 * Drive the loop under fake timers: yield to real I/O until the loop has
 * registered its poll timer, then advance one poll interval.
 */
async function drive(promise: Promise<ReloadLockOutcome>): Promise<ReloadLockOutcome> {
  let settled = false;
  void promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  while (!settled) {
    if (vi.getTimerCount() > 0) {
      await vi.advanceTimersByTimeAsync(RELOAD_SUPERSEDE_POLL_MS);
    } else {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return promise;
}

describe('reload supersede', () => {
  beforeEach(() => {
    testHome = join(tmpdir(), `overdeck-reload-supersede-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.OVERDECK_HOME = testHome;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    rmSync(testHome, { recursive: true, force: true });
  });

  it('acquires at once and leaves no marker file', async () => {
    const d = deps({ acquire: vi.fn(async () => handle) });

    const outcome = await acquireReloadLock(OWN_SHA, d);

    expect(outcome).toEqual({ kind: 'acquired', lock: handle });
    expect(d.acquire).toHaveBeenCalledWith('pan reload', { targetSha: OWN_SHA, supersedable: true });
    expect(existsSync(reloadSupersedeFile(OWN_PID))).toBe(false);
  });

  it("refuses a non-reload holder with today's message", async () => {
    const d = deps({ readHolder: vi.fn(async () => ({ pid: 77, ts: Date.now(), caller: 'pan restart' })) });

    const outcome = await acquireReloadLock(OWN_SHA, d);

    expect(outcome).toEqual({ kind: 'refused', message: 'restart in progress (held by PID 77 (pan restart))' });
    expect(existsSync(reloadSupersedeFile(OWN_PID))).toBe(false);
  });

  it('refuses an old-CLI reload holder that is not supersedable', async () => {
    const d = deps({ readHolder: vi.fn(async () => ({ pid: 77, ts: Date.now(), caller: 'pan reload' })) });

    const outcome = await acquireReloadLock(OWN_SHA, d);

    expect(outcome).toEqual({ kind: 'refused', message: 'restart in progress (held by PID 77 (pan reload))' });
    expect(existsSync(reloadSupersedeFile(OWN_PID))).toBe(false);
  });

  it('refuses a skip-build newcomer', async () => {
    const d = deps();

    const outcome = await acquireReloadLock(undefined, d);

    expect(outcome).toEqual({ kind: 'refused', message: 'restart in progress (held by PID 77 (pan reload))' });
    expect(d.acquire).toHaveBeenCalledWith('pan reload', { supersedable: true });
    expect(d.isAncestor).not.toHaveBeenCalled();
  });

  it('is covered when the holder builds the same SHA', async () => {
    const holder = reloadHolder({ targetSha: OWN_SHA });
    const d = deps({ readHolder: vi.fn(async () => holder) });

    const outcome = await acquireReloadLock(OWN_SHA, d);

    expect(outcome).toEqual({ kind: 'covered', holder });
    expect(d.isAncestor).not.toHaveBeenCalled();
    expect(existsSync(reloadSupersedeFile(OWN_PID))).toBe(false);
  });

  it('is covered when the holder builds a newer SHA', async () => {
    const isAncestor = vi.fn(async (ancestor: string, descendant: string) => ancestor === OWN_SHA && descendant === HOLDER_SHA);
    const d = deps({ isAncestor });

    const outcome = await acquireReloadLock(OWN_SHA, d);

    expect(outcome.kind).toBe('covered');
    expect(isAncestor).toHaveBeenCalledWith(OWN_SHA, HOLDER_SHA);
    expect(existsSync(reloadSupersedeFile(OWN_PID))).toBe(false);
  });

  it('refuses a holder whose history diverged', async () => {
    const d = deps({ isAncestor: vi.fn(async () => false) });

    const outcome = await acquireReloadLock(OWN_SHA, d);

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.message).toContain('have diverged');
    expect(existsSync(reloadSupersedeFile(OWN_PID))).toBe(false);
  });

  it('refuses when the ancestry check fails', async () => {
    const d = deps({ isAncestor: vi.fn(async () => { throw new Error('bad object'); }) });

    const outcome = await acquireReloadLock(OWN_SHA, d);

    expect(outcome.kind === 'refused' && outcome.message).toContain('have diverged');
  });

  it('writes and refreshes its own marker, then acquires once the holder lets go', async () => {
    const seen: string[] = [];
    let calls = 0;
    const acquire = vi.fn(async () => {
      calls += 1;
      if (calls > 1) {
        const marker = JSON.parse(readFileSync(reloadSupersedeFile(OWN_PID), 'utf8')) as { targetPid: number; refreshedAt: string };
        expect(marker.targetPid).toBe(77);
        seen.push(marker.refreshedAt);
      }
      return calls > 3 ? handle : null;
    });
    const isAncestor = vi.fn(async (ancestor: string, descendant: string) => ancestor === HOLDER_SHA && descendant === OWN_SHA);
    const d = deps({ acquire, isAncestor });

    const outcome = await drive(acquireReloadLock(OWN_SHA, d));

    expect(outcome).toEqual({ kind: 'acquired', lock: handle });
    expect(seen).toHaveLength(3);
    expect(Date.parse(seen[1]!)).toBeGreaterThan(Date.parse(seen[0]!));
    expect(Date.parse(seen[2]!)).toBeGreaterThan(Date.parse(seen[1]!));
    // git runs once per holder, not once per poll; the ask is logged once.
    expect(isAncestor).toHaveBeenCalledTimes(2);
    expect(d.log).toHaveBeenCalledTimes(1);
    expect(d.log.mock.calls[0]![0]).toContain('asked it to step aside for origin/main bbbbbbbbbbbb');
    expect(existsSync(reloadSupersedeFile(OWN_PID))).toBe(false);
  });

  it('two waiters keep separate markers and one dying does not strand the other', async () => {
    const refreshedAt = new Date(Date.now()).toISOString();
    await writeReloadSupersedeRequest({ targetPid: 77, byPid: 101, targetSha: 'c'.repeat(40), refreshedAt });
    await writeReloadSupersedeRequest({ targetPid: 77, byPid: 102, targetSha: 'd'.repeat(40), refreshedAt });
    expect(existsSync(reloadSupersedeFile(101))).toBe(true);
    expect(existsSync(reloadSupersedeFile(102))).toBe(true);

    await deleteOwnReloadSupersedeRequest(102);
    const detail = await reloadSupersedeDetail(77, { isAlive: (pid) => pid !== 102 });

    expect(existsSync(reloadSupersedeFile(101))).toBe(true);
    expect(detail).toBe('superseded by a newer pan reload (PID 101) that builds origin/main cccccccccccc');
  });

  it('gives up after 20 minutes and deletes its marker', async () => {
    const isAncestor = vi.fn(async (ancestor: string, descendant: string) => ancestor === HOLDER_SHA && descendant === OWN_SHA);
    const d = deps({ isAncestor });

    const outcome = await drive(acquireReloadLock(OWN_SHA, d));

    expect(outcome).toEqual({
      kind: 'refused',
      message: 'restart in progress (held by PID 77 (pan reload)); it did not step aside for a newer reload within 20 minutes',
    });
    expect(existsSync(reloadSupersedeFile(OWN_PID))).toBe(false);
  });

  it('reloadSupersedeDetail ignores another target pid, a dead writer, and a stale marker', async () => {
    const now = Date.now();
    const fresh = new Date(now).toISOString();

    await writeReloadSupersedeRequest({ targetPid: 99, byPid: 201, targetSha: OWN_SHA, refreshedAt: fresh });
    expect(await reloadSupersedeDetail(77, { isAlive: () => true, now: () => now })).toBeNull();
    await deleteOwnReloadSupersedeRequest(201);

    await writeReloadSupersedeRequest({ targetPid: 77, byPid: 202, targetSha: OWN_SHA, refreshedAt: fresh });
    expect(await reloadSupersedeDetail(77, { isAlive: () => false, now: () => now })).toBeNull();
    await deleteOwnReloadSupersedeRequest(202);

    await writeReloadSupersedeRequest({ targetPid: 77, byPid: 203, targetSha: OWN_SHA, refreshedAt: new Date(now - 30_000).toISOString() });
    expect(await reloadSupersedeDetail(77, { isAlive: () => true, now: () => now })).toBeNull();
    await deleteOwnReloadSupersedeRequest(203);

    await writeReloadSupersedeRequest({ targetPid: 77, byPid: 204, targetSha: OWN_SHA, refreshedAt: fresh });
    expect(await reloadSupersedeDetail(77, { isAlive: () => true, now: () => now })).toBe(
      'superseded by a newer pan reload (PID 204) that builds origin/main bbbbbbbbbbbb',
    );
  });
});
