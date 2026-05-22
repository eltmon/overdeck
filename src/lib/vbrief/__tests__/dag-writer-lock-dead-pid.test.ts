/**
 * Regression test for #1174 — orphan writer-lock reclaim.
 *
 * When a writer crashes between `mkdir(lockPath)` and `rm(lockPath)`, the lock
 * directory + owner.json persist forever. Every subsequent writer hits EEXIST
 * and either burns through its retry budget or throws "vBRIEF plan writer
 * conflict: <writerId> pid=<dead-pid> already owns".
 *
 * Fix: when the EEXIST owner.json's pid fails `process.kill(pid, 0)` with
 * ESRCH, the writer reclaims the lock and retries the acquire.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { VBriefDocument } from '../types.js';
import { applyTaskOperationToPlanFileEffect } from '../dag.js';
import { isPidDead, removeStaleLockEffect } from '../dag.js';

function makeDoc(): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'PAN-1174',
      title: 'PAN-1174 dead-pid reclaim',
      status: 'active',
      sequence: 1,
      items: [
        {
          id: 'item-1',
          title: 'item-1',
          status: 'pending',
          subItems: [{ id: 'item-1.ac1', title: 'AC', status: 'pending' as any }],
        },
      ],
      edges: [],
    },
  };
}

/**
 * Find a definitely-dead PID by forking a no-op child, waiting for it to exit,
 * and capturing its PID. The kernel may reuse PIDs but only after a wraparound,
 * so this gives us a reliably-dead PID for the test window.
 */
function findDeadPid(): number {
  // Use an obviously invalid high PID; the kernel's PID space rarely gets this
  // high (max_pid is typically 4194304 on Linux but actual reuse stays under
  // a few hundred thousand under normal load).
  return 999_999_999;
}

describe('#1174 orphan writer-lock reclaim on dead owner pid', () => {
  let dir: string;
  let planPath: string;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/vbrief-dead-pid-`);
    mkdirSync(join(dir, '.pan'), { recursive: true });
    planPath = join(dir, '.pan', 'spec.vbrief.json');
    writeFileSync(planPath, JSON.stringify(makeDoc(), null, 2), 'utf-8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('isPidDead returns true for a process that does not exist', () => {
    expect(isPidDead(findDeadPid())).toBe(true);
  });

  it('isPidDead returns false for the current process', () => {
    expect(isPidDead(process.pid)).toBe(false);
  });

  it('isPidDead returns false for undefined / null / non-positive values', () => {
    expect(isPidDead(undefined)).toBe(false);
    expect(isPidDead(null)).toBe(false);
    expect(isPidDead(0)).toBe(false);
    expect(isPidDead(-1)).toBe(false);
  });

  it('removeStaleLockAsync removes lock dir and sibling .tmp files', async () => {
    const lockPath = `${planPath}.writer.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner.json'), '{}', 'utf-8');
    const tmpPath = `${planPath}.${process.pid}.123.tmp`;
    writeFileSync(tmpPath, '{}', 'utf-8');
    await Effect.runPromise(removeStaleLockEffect(planPath));
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(tmpPath)).toBe(false);
  });

  it('reclaims a lock whose owner pid is dead and completes the operation', async () => {
    // Plant an orphan lock with a dead owner pid — mirrors the state left by
    // a crashed review-status writer or planning agent.
    const lockPath = `${planPath}.writer.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      join(lockPath, 'owner.json'),
      JSON.stringify({
        writerId: 'review-status-deceased',
        pid: findDeadPid(),
        acquiredAt: '2026-01-01T00:00:00Z',
      }),
      'utf-8',
    );

    const result = await Effect.runPromise(applyTaskOperationToPlanFileEffect(planPath, {
      type: 'claim',
      itemId: 'item-1',
      expectedSequence: 1,
      writerId: 'writer-reclaim',
    }));

    expect(result.item.status).toBe('running');
    // The reclaim path removes the orphan lock, then the happy path's finally
    // block removes the lock the new writer acquired.
    expect(existsSync(lockPath)).toBe(false);
  });

  it('does NOT reclaim a lock whose owner pid is the current (alive) process', async () => {
    // If the owner is alive (e.g., another in-process writer), we must NOT
    // steal the lock — that would corrupt the writer's atomic transaction.
    const lockPath = `${planPath}.writer.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      join(lockPath, 'owner.json'),
      JSON.stringify({
        writerId: 'writer-still-alive',
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }),
      'utf-8',
    );

    await expect(
      Effect.runPromise(applyTaskOperationToPlanFileEffect(planPath, {
        type: 'claim',
        itemId: 'item-1',
        expectedSequence: 1,
        writerId: 'writer-conflict',
      })),
    ).rejects.toThrow(/writer conflict/);

    expect(existsSync(lockPath)).toBe(true);
    // Manually clean up since the throw path doesn't release a lock it didn't own.
    rmSync(lockPath, { recursive: true, force: true });
  });
});
