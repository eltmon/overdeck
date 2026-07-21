import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireRecordLock, RecordLockError, releaseRecordLock } from '../fs-lock.js';

describe('record fs-lock', () => {
  let root: string;

  beforeEach(() => {
    vi.useFakeTimers();
    root = mkdtempSync(join(tmpdir(), 'pan-fs-lock-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it('creates parent directories and records its owner', async () => {
    const lockPath = join(root, 'locks', 'records', 'project', 'PAN-1.lock');
    const owner = await acquireRecordLock(lockPath, { writerId: 'agent-one', recordPath: join(root, 'record.json') });
    expect(owner.writerId).toBe('agent-one');
    expect(JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'))).toMatchObject({ writerId: 'agent-one' });
    await releaseRecordLock(lockPath);
  });

  it('waits through the bounded retry ladder and reports the live owner', async () => {
    const lockPath = join(root, 'PAN-2.lock');
    await acquireRecordLock(lockPath, { writerId: 'agent-one', recordPath: join(root, 'record.json') });
    const contender = acquireRecordLock(lockPath, { writerId: 'agent-two', recordPath: join(root, 'record.json'), retryDelaysMs: [5, 10] });
    const rejection = expect(contender).rejects.toMatchObject({
      name: 'RecordLockError',
      owner: expect.stringContaining('agent-one'),
    });
    for (const delay of [5, 10]) {
      while (vi.getTimerCount() === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(delay);
    }
    await rejection;
    await releaseRecordLock(lockPath);
  });

  it('reclaims a lock owned by a provably dead pid', async () => {
    const lockPath = join(root, 'PAN-3.lock');
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ writerId: 'dead', pid: 2_147_483_647, acquiredAt: 'then' }));
    const owner = await acquireRecordLock(lockPath, { writerId: 'replacement', recordPath: join(root, 'record.json') });
    expect(owner.writerId).toBe('replacement');
    await releaseRecordLock(lockPath);
  });

  it('sweeps orphaned record transaction files only after acquiring the lock', async () => {
    const recordPath = join(root, 'records', 'pan-4.json');
    await mkdir(join(root, 'records'), { recursive: true });
    const orphan = `${recordPath}.123.456.tmp`;
    await writeFile(orphan, 'partial');
    const lockPath = join(root, 'locks', 'PAN-4.lock');
    await acquireRecordLock(lockPath, { writerId: 'agent', recordPath });
    await expect(readFile(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
    await releaseRecordLock(lockPath);
  });

  it('exports a structured contention error', () => {
    expect(new RecordLockError('/lock', 'owner')).toMatchObject({ name: 'RecordLockError', lockPath: '/lock' });
  });
});
