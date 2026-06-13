import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeBeadCounts, IssueDataService } from '../issue-data-service.js';
import type { VBriefDocument } from '../../../../lib/vbrief/types.js';

describe('computeBeadCounts', () => {
  function makeDoc(items: Array<{ status: string }>): VBriefDocument {
    return {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'plan-1',
        title: 'Test Plan',
        status: 'active',
        items: items.map((it, idx) => ({
          id: `item-${idx}`,
          title: `Task ${idx}`,
          status: it.status as any,
        })),
        edges: [],
      },
    };
  }

  it('returns completed and total for a plan with 7 completed of 12', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      status: i < 7 ? 'completed' : 'pending',
    }));
    const doc = makeDoc(items);
    expect(computeBeadCounts(doc)).toEqual({ completed: 7, total: 12 });
  });

  it('returns 0 completed for a plan with 0 of 5', () => {
    const items = Array.from({ length: 5 }, () => ({ status: 'pending' }));
    const doc = makeDoc(items);
    expect(computeBeadCounts(doc)).toEqual({ completed: 0, total: 5 });
  });

  it('returns null when the plan has no items', () => {
    const doc = makeDoc([]);
    expect(computeBeadCounts(doc)).toBeNull();
  });

  it('returns null when the document is null', () => {
    expect(computeBeadCounts(null)).toBeNull();
  });

  it('returns null when the document has no plan', () => {
    const doc = {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: { id: 'plan-1', title: 'Test', status: 'active', items: [], edges: [] },
    } as VBriefDocument;
    expect(computeBeadCounts(doc)).toBeNull();
  });
});

// PAN-1817: peer dashboards (workspace containers, PANOPTICON_DISABLE_DEACON=1) must
// load the cache but start ZERO tracker polling. ~17 container pollers against the one
// shared Linear API key exhausted Linear's 2500/hr quota. This locks the gate so it
// can't be silently removed — deleting `skipPolling` turns this suite red.
describe('IssueDataService tracker-polling gate (PAN-1817)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function makeService() {
    // Constructor only stores the cache; scheduleNext calls getBackoffMs.
    const cache = { getBackoffMs: () => 0 } as any;
    const svc = new IssueDataService(cache);
    // Stub the cache-loading / snapshot plumbing so the test exercises only the
    // poll-vs-no-poll branch, with no SQLite or network dependency.
    vi.spyOn(svc as any, 'ensureShadowStateLoaded').mockResolvedValue(undefined);
    vi.spyOn(svc as any, 'loadCachedData').mockImplementation(() => {});
    vi.spyOn(svc as any, 'pushSnapshot').mockImplementation(() => {});
    const polls = {
      github: vi.spyOn(svc as any, 'pollGitHub').mockResolvedValue(undefined),
      linear: vi.spyOn(svc as any, 'pollLinear').mockResolvedValue(undefined),
      rally: vi.spyOn(svc as any, 'pollRally').mockResolvedValue(undefined),
    };
    return { svc, polls };
  }

  it('skipPolling:true loads the cache but starts NO tracker fetches and schedules no timers', async () => {
    const { svc, polls } = makeService();
    await svc.start({ skipPolling: true });

    expect(polls.github).not.toHaveBeenCalled();
    expect(polls.linear).not.toHaveBeenCalled();
    expect(polls.rally).not.toHaveBeenCalled();
    expect((svc as any).trackers.github.timer).toBeNull();
    expect((svc as any).trackers.linear.timer).toBeNull();
    expect((svc as any).trackers.rally.timer).toBeNull();

    // Cache was still loaded so the peer dashboard can serve issues read-only.
    expect((svc as any).loadCachedData).toHaveBeenCalledTimes(1);
    svc.stop();
  });

  it('default start() (no options) DOES poll every tracker — the gate is strictly opt-in', async () => {
    const { svc, polls } = makeService();
    await svc.start();

    // Polls are invoked synchronously inside Promise.allSettled([...]).
    expect(polls.github).toHaveBeenCalledTimes(1);
    expect(polls.linear).toHaveBeenCalledTimes(1);
    expect(polls.rally).toHaveBeenCalledTimes(1);
    svc.stop();
  });
});

describe('IssueDataService poll-outcome recording (PAN-1817)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function makeServiceWithRecording() {
    const recorded: Array<{ tracker: string; status: string; message: string }> = [];
    const cache = {
      getBackoffMs: () => 0,
      set: vi.fn(),
      recordPollHealth: vi.fn((tracker: string, health: { status: string; message: string }) => {
        recorded.push({ tracker, ...health });
      }),
      updateRateLimit: vi.fn(),
    } as any;

    const svc = new IssueDataService(cache);
    vi.spyOn(svc as any, 'ensureShadowStateLoaded').mockResolvedValue(undefined);
    vi.spyOn(svc as any, 'loadCachedData').mockImplementation(() => {});
    vi.spyOn(svc as any, 'pushSnapshot').mockImplementation(() => {});
    vi.spyOn(svc as any, 'pushUpdated').mockImplementation(() => {});
    vi.spyOn(svc as any, 'pushMeta').mockImplementation(() => {});

    return { svc, cache, recorded };
  }

  it('records quota_exhausted when Linear poll error matches rate-limit pattern', async () => {
    const { svc } = makeServiceWithRecording();
    vi.spyOn(svc as any, 'fetchLinearIssues').mockRejectedValue(new Error('API rate-limit exceeded'));

    await (svc as any).pollLinear();

    expect((svc as any).cache.recordPollHealth).toHaveBeenCalledWith('linear', {
      status: 'quota_exhausted',
      message: 'API rate-limit exceeded',
    });
  });

  it('records error for a non-rate-limit Linear poll error', async () => {
    const { svc } = makeServiceWithRecording();
    vi.spyOn(svc as any, 'fetchLinearIssues').mockRejectedValue(new Error('network timeout'));

    await (svc as any).pollLinear();

    expect((svc as any).cache.recordPollHealth).toHaveBeenCalledWith('linear', {
      status: 'error',
      message: 'network timeout',
    });
  });

  it('records ok on a successful Linear poll, clearing any prior quota signal', async () => {
    const { svc } = makeServiceWithRecording();
    vi.spyOn(svc as any, 'fetchLinearIssues').mockResolvedValue([]);

    await (svc as any).pollLinear();

    expect((svc as any).cache.recordPollHealth).toHaveBeenCalledWith('linear', {
      status: 'ok',
      message: 'ok',
    });
  });

  it('does NOT call updateRateLimit for linear (rate_limits table stays GitHub-only)', async () => {
    const { svc, cache } = makeServiceWithRecording();
    vi.spyOn(svc as any, 'fetchLinearIssues').mockRejectedValue(new Error('API rate-limit exceeded'));

    await (svc as any).pollLinear();

    expect(cache.updateRateLimit).not.toHaveBeenCalled();
  });
});
