/**
 * PAN-4649 W-4: `POST /api/workers` body validation and the shared
 * `startWorker()` core, driven through the exported helpers with a fake start.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

import { parseStartWorkerBody, startWorkerFromBody } from '../routes/workers.js';

describe('POST /api/workers (PAN-4649 FR-4)', () => {
  it('parseStartWorkerBody rejects a missing issueId, an empty prompt, an unknown harness and a bad effort', () => {
    expect(parseStartWorkerBody({ prompt: 'do it' })).toEqual({ ok: false, error: expect.stringContaining('issueId') });
    expect(parseStartWorkerBody({ issueId: 'PAN-1', prompt: '   ' })).toEqual({ ok: false, error: expect.stringContaining('prompt') });
    expect(parseStartWorkerBody({ issueId: 'PAN-1', prompt: 'x', harness: 'vim' })).toEqual({ ok: false, error: expect.stringContaining('harness') });
    expect(parseStartWorkerBody({ issueId: 'PAN-1', prompt: 'x', effort: 'extreme' })).toEqual({ ok: false, error: expect.stringContaining('effort') });
    expect(parseStartWorkerBody({ issueId: 'PAN-1', prompt: 'x', readOnly: 'yes' })).toEqual({ ok: false, error: expect.stringContaining('readOnly') });
    expect(parseStartWorkerBody(['PAN-1'])).toEqual({ ok: false, error: expect.stringContaining('object') });
  });

  it('parseStartWorkerBody keeps only the given optional fields and sets parentId to null', () => {
    expect(parseStartWorkerBody({ issueId: 'PAN-1', prompt: 'x', harness: 'codex', effort: 'high', readOnly: true, name: 'scout' })).toEqual({
      ok: true,
      value: { issueId: 'PAN-1', prompt: 'x', parentId: null, harness: 'codex', effort: 'high', readOnly: true, name: 'scout' },
    });
  });

  it('startWorkerFromBody returns the started worker and passes parentId null', async () => {
    const start = vi.fn(async () => ({ id: 'worker-pan-1-1', cwd: '/w/.swarm/worker-1', branch: 'feature/pan-1-worker-1', paneReady: true as const }));
    const result = await startWorkerFromBody({ issueId: 'PAN-1', prompt: 'investigate', model: 'opus' }, start);
    expect(result).toEqual({ status: 200, body: { id: 'worker-pan-1-1', cwd: '/w/.swarm/worker-1', branch: 'feature/pan-1-worker-1' } });
    expect(start).toHaveBeenCalledWith({ issueId: 'PAN-1', prompt: 'investigate', parentId: null, model: 'opus' });
  });

  it('startWorkerFromBody answers 400 with the startWorker error text', async () => {
    const start = vi.fn(async () => {
      throw new Error('PAN-1 has no workspace at /w. Run pan start PAN-1 first.');
    });
    expect(await startWorkerFromBody({ issueId: 'PAN-1', prompt: 'x' }, start)).toEqual({
      status: 400,
      body: { error: 'PAN-1 has no workspace at /w. Run pan start PAN-1 first.' },
    });
  });

  it('startWorkerFromBody answers 400 for an invalid body without starting anything', async () => {
    const start = vi.fn();
    expect(await startWorkerFromBody({ prompt: 'x' }, start)).toEqual({ status: 400, body: { error: expect.stringContaining('issueId') } });
    expect(start).not.toHaveBeenCalled();
  });
});
