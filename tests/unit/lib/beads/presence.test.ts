import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getAllBeads = vi.fn();

vi.mock('../../../../src/lib/beads/resolver.js', () => ({
  createBeadsResolver: () => ({ getAllBeads }),
}));

// Same store for every dir so tests exercise the shared-key path deterministically.
vi.mock('../../../../src/lib/beads/home.js', () => ({
  resolveCanonicalBeadsHome: () => '/canonical/.beads',
}));

import {
  readIssuesWithBeads,
  readAllBeadsCached,
  readBeadsForIssueCached,
  clearBeadsSnapshotCache,
} from '../../../../src/lib/beads/presence.js';

const bead = (id: string, labels: string[]) => ({ id, title: id, status: 'open', labels });

describe('beads presence snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearBeadsSnapshotCache();
    getAllBeads.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves repeated reads from one bulk bd call within the TTL', async () => {
    getAllBeads.mockResolvedValue({ ok: true, value: [bead('b1', ['pan-1'])] });

    await readAllBeadsCached('/project');
    await readAllBeadsCached('/project/workspaces/feature-pan-1');
    const forIssue = await readBeadsForIssueCached('/project', 'PAN-1');

    expect(getAllBeads).toHaveBeenCalledTimes(1);
    expect(forIssue).toEqual({ ok: true, value: [bead('b1', ['pan-1'])] });
  });

  it('re-reads after the TTL expires', async () => {
    getAllBeads.mockResolvedValue({ ok: true, value: [] });

    await readAllBeadsCached('/project');
    vi.advanceTimersByTime(10_001);
    await readAllBeadsCached('/project');

    expect(getAllBeads).toHaveBeenCalledTimes(2);
  });

  it('caches failed reads for the TTL so per-request retries cannot re-create the process storm', async () => {
    getAllBeads.mockResolvedValue({ ok: false, reason: 'lock contention', transient: true, error: null });

    const first = await readBeadsForIssueCached('/project', 'PAN-1');
    const second = await readBeadsForIssueCached('/project', 'PAN-2');

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(getAllBeads).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent in-flight reads', async () => {
    let release!: (value: { ok: true; value: never[] }) => void;
    getAllBeads.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const a = readAllBeadsCached('/project');
    const b = readAllBeadsCached('/project');
    release({ ok: true, value: [] });
    await Promise.all([a, b]);

    expect(getAllBeads).toHaveBeenCalledTimes(1);
  });

  it('filters per-issue beads by label, case-insensitively', async () => {
    getAllBeads.mockResolvedValue({
      ok: true,
      value: [bead('b1', ['PAN-7', 'workspace-x']), bead('b2', ['pan-8'])],
    });

    const result = await readBeadsForIssueCached('/project', 'pan-7');
    expect(result).toEqual({ ok: true, value: [bead('b1', ['PAN-7', 'workspace-x'])] });
  });

  it('derives the issues-with-beads set from bead labels', async () => {
    getAllBeads.mockResolvedValue({
      ok: true,
      value: [bead('b1', ['pan-1', 'not a label']), bead('b2', ['min-42'])],
    });

    const presence = await readIssuesWithBeads('/project');
    expect(presence.known).toBe(true);
    expect([...presence.set].sort()).toEqual(['MIN-42', 'PAN-1']);
  });

  it('returns known:false when the bulk read fails', async () => {
    getAllBeads.mockResolvedValue({ ok: false, reason: 'boom', transient: false, error: null });

    const presence = await readIssuesWithBeads('/project');
    expect(presence.known).toBe(false);
    expect(presence.set.size).toBe(0);
  });
});
