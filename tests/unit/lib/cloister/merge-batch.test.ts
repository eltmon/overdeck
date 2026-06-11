import { describe, it, expect, vi } from 'vitest';
import { shipMergeBatch, type MergeBatchDeps } from '../../../../src/lib/cloister/merge-batch.js';

function deps(results: Record<string, { ok: true } | { ok: false; reason: string } | Error>): MergeBatchDeps & {
  merge: ReturnType<typeof vi.fn>;
} {
  const merge = vi.fn(async (issueId: string) => {
    const r = results[issueId];
    if (r instanceof Error) throw r;
    return r ?? { ok: true as const };
  });
  return { merge };
}

describe('shipMergeBatch (PAN-1691 ship UAT candidate / merge next N)', () => {
  it('merges every issue in order when all succeed', async () => {
    const d = deps({ 'PAN-1': { ok: true }, 'PAN-2': { ok: true } });
    const out = await shipMergeBatch(['PAN-1', 'PAN-2'], d);
    expect(out).toEqual([
      { issueId: 'PAN-1', result: 'merged' },
      { issueId: 'PAN-2', result: 'merged' },
    ]);
    expect(d.merge).toHaveBeenCalledTimes(2);
  });

  it('stops at the first failure and skips the rest', async () => {
    const d = deps({ 'PAN-1': { ok: true }, 'PAN-2': { ok: false, reason: 'CI red' }, 'PAN-3': { ok: true } });
    const out = await shipMergeBatch(['PAN-1', 'PAN-2', 'PAN-3'], d);
    expect(out).toEqual([
      { issueId: 'PAN-1', result: 'merged' },
      { issueId: 'PAN-2', result: 'failed', reason: 'CI red' },
      { issueId: 'PAN-3', result: 'skipped' },
    ]);
    expect(d.merge).toHaveBeenCalledTimes(2); // PAN-3 never attempted
  });

  it('treats a thrown merge as a failure and stops', async () => {
    const d = deps({ 'PAN-1': new Error('boom'), 'PAN-2': { ok: true } });
    const out = await shipMergeBatch(['PAN-1', 'PAN-2'], d);
    expect(out).toEqual([
      { issueId: 'PAN-1', result: 'failed', reason: 'boom' },
      { issueId: 'PAN-2', result: 'skipped' },
    ]);
  });

  it('returns empty for an empty batch', async () => {
    expect(await shipMergeBatch([], deps({}))).toEqual([]);
  });
});
