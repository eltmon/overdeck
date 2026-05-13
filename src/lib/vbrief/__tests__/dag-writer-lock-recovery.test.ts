/**
 * PAN-977 review-round-17 regression test.
 *
 * If `mkdir(lockPath)` succeeds inside `assertSingleWriterAsync` but the
 * subsequent `writeFile(owner.json)` throws a non-EEXIST error (ENOSPC,
 * EPERM, ENAMETOOLONG, …), the orphan lock directory must be removed
 * before re-throwing. Otherwise every subsequent
 * `applyTaskOperationToPlanFileAsync` for that plan path wedges
 * permanently — mkdir → EEXIST → owner.json read → ENOENT → "unknown
 * writer" → permanent writer-conflict, and `activePlanWriters.set` never
 * ran so the in-memory release path can't free it either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Hoisted mock: replace fs/promises.writeFile with a function we can toggle.
// `vi.hoisted` ensures the flag is created before vi.mock factory runs.
const fsHooks = vi.hoisted(() => ({
  failNextWrite: false as boolean | string, // when string, only target paths ending with this value fail
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    writeFile: vi.fn(async (target: any, ...rest: any[]) => {
      if (fsHooks.failNextWrite) {
        const matches =
          typeof fsHooks.failNextWrite === 'string'
            ? typeof target === 'string' && target.endsWith(fsHooks.failNextWrite)
            : true;
        if (matches) {
          fsHooks.failNextWrite = false;
          throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
        }
      }
      return actual.writeFile(target, ...rest);
    }),
  };
});

import type { VBriefDocument } from '../types.js';

function makeDoc(): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'PAN-977',
      title: 'PAN-977 writer-lock recovery',
      status: 'active',
      sequence: 1,
      items: [
        {
          id: 'PAN-977-recover',
          title: 'PAN-977-recover',
          status: 'pending',
          subItems: [{ id: 'PAN-977-recover.ac1', title: 'AC', status: 'pending' as any }],
        },
      ],
      edges: [],
    },
  };
}

describe('PAN-977 writer-lock orphan cleanup', () => {
  let dir: string;
  let planPath: string;

  beforeEach(() => {
    dir = mkdtempSync(`${tmpdir()}/vbrief-writer-lock-`);
    mkdirSync(join(dir, '.pan'), { recursive: true });
    planPath = join(dir, '.pan', 'spec.vbrief.json');
    writeFileSync(planPath, JSON.stringify(makeDoc(), null, 2), 'utf-8');
    fsHooks.failNextWrite = false;
  });

  afterEach(() => {
    fsHooks.failNextWrite = false;
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes the lock directory when owner.json write fails so the next call can recover', async () => {
    const lockPath = `${planPath}.writer.lock`;
    // Re-import the module under test AFTER vi.mock takes effect.
    const { applyTaskOperationToPlanFileAsync } = await import('../dag.js');

    // Force the next owner.json write to fail with a non-EEXIST error. This
    // mirrors a transient ENOSPC/EPERM at the worst possible moment: after
    // mkdir(lockPath) succeeds but before the in-memory writer map is set.
    fsHooks.failNextWrite = 'owner.json';

    await expect(
      applyTaskOperationToPlanFileAsync(planPath, {
        type: 'claim',
        itemId: 'PAN-977-recover',
        expectedSequence: 1,
        writerId: 'writer-orphan',
      }),
    ).rejects.toThrow(/ENOSPC/);

    // Critical assertion: the lock directory must not survive the failed
    // acquisition. If this fails, every subsequent claim wedges with
    // "writer conflict: unknown writer already owns the worktree".
    expect(existsSync(lockPath)).toBe(false);

    // Subsequent claim must succeed (writeFile is now passthrough).
    const result = await applyTaskOperationToPlanFileAsync(planPath, {
      type: 'claim',
      itemId: 'PAN-977-recover',
      expectedSequence: 1,
      writerId: 'writer-recovered',
    });
    expect(result.item.status).toBe('running');

    // And the lock directory should be cleaned up by the surrounding finally
    // block now that the happy path ran.
    expect(existsSync(lockPath)).toBe(false);
  });
});
