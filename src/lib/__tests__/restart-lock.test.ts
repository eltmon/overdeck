import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireRestartLock, readRestartLockHolder } from '../restart-lock.js';

const originalPanopticonHome = process.env.PANOPTICON_HOME;
let testHome: string;

function lockPath(): string {
  return join(testHome, 'restart.lock');
}

function writeLock(holder: { pid: number; ts: number; caller: string }) {
  mkdirSync(testHome, { recursive: true });
  writeFileSync(lockPath(), `${JSON.stringify(holder)}\n`, 'utf8');
}

describe('restart lock', () => {
  beforeEach(() => {
    testHome = join(tmpdir(), `panopticon-restart-lock-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.PANOPTICON_HOME = testHome;
  });

  afterEach(() => {
    if (originalPanopticonHome === undefined) {
      delete process.env.PANOPTICON_HOME;
    } else {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    }
    rmSync(testHome, { recursive: true, force: true });
  });

  it('acquires a fresh lock and auto-creates the parent directory', async () => {
    const handle = await acquireRestartLock('test caller');

    expect(handle).not.toBeNull();
    expect(existsSync(lockPath())).toBe(true);
    expect(await readRestartLockHolder()).toMatchObject({ pid: process.pid, caller: 'test caller' });
  });

  it('returns null when a fresh live lock is already held by a different PID', async () => {
    writeLock({ pid: 1, ts: Date.now(), caller: 'first caller' });

    expect(await acquireRestartLock('second caller')).toBeNull();
  });

  it('overwrites a lock that is stale by time', async () => {
    writeLock({ pid: process.pid, ts: Date.now() - 5 * 60 * 1000 - 1, caller: 'old caller' });

    const handle = await acquireRestartLock('new caller');

    expect(handle).not.toBeNull();
    expect(await readRestartLockHolder()).toMatchObject({ pid: process.pid, caller: 'new caller' });
  });

  it('overwrites a lock whose PID is dead', async () => {
    writeLock({ pid: 999_999_999, ts: Date.now(), caller: 'dead caller' });

    const handle = await acquireRestartLock('new caller');

    expect(handle).not.toBeNull();
    expect(await readRestartLockHolder()).toMatchObject({ pid: process.pid, caller: 'new caller' });
  });

  it('overwrites a malformed lock instead of treating it as held forever', async () => {
    mkdirSync(testHome, { recursive: true });
    writeFileSync(lockPath(), '', 'utf8');

    const handle = await acquireRestartLock('new caller');

    expect(handle).not.toBeNull();
    expect(await readRestartLockHolder()).toMatchObject({ pid: process.pid, caller: 'new caller' });
  });

  it('release deletes the lockfile and is idempotent', async () => {
    const handle = await acquireRestartLock('test caller');
    expect(handle).not.toBeNull();

    await handle?.release();
    await handle?.release();

    expect(existsSync(lockPath())).toBe(false);
    expect(await readRestartLockHolder()).toBeNull();
  });

  it('reads the lock holder from disk', async () => {
    writeLock({ pid: process.pid, ts: 123, caller: 'reader' });

    expect(await readRestartLockHolder()).toEqual({ pid: process.pid, ts: 123, caller: 'reader' });
    expect(readFileSync(lockPath(), 'utf8')).toContain('reader');
  });
});
