import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { job } = vi.hoisted(() => ({ job: vi.fn() }));
vi.mock('../dashboard-db-task.js', () => ({ runDashboardDbJob: job }));

beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); job.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('polling worker snapshots', () => {
  it('shares rolling agent aggregates across list order and invalidates on membership changes', async () => {
    const { getAgentCostStatsSnapshot: get } = await import('../dashboard-poll-snapshots.js');
    job.mockResolvedValue([]);
    await get([]);
    expect(job).not.toHaveBeenCalled();
    const nowMs = Date.now();
    await Promise.all([get(['b', 'a']), get(['a', 'b', 'a'])]);
    expect(job).toHaveBeenCalledExactlyOnceWith('getAgentCostStats', { agentIds: ['a', 'b'], nowMs });
    await vi.advanceTimersByTimeAsync(15_000);
    await get(['a', 'b']);
    await vi.advanceTimersByTimeAsync(0);
    expect(job).toHaveBeenLastCalledWith('getAgentCostStats', { agentIds: ['a', 'b'], nowMs: nowMs + 15_000 });
    expect(job).toHaveBeenCalledTimes(2);
    await get(['c']);
    expect(job).toHaveBeenCalledTimes(3);
    expect(job).toHaveBeenLastCalledWith('getAgentCostStats', { agentIds: ['c'], nowMs: nowMs + 15_000 });
  });

  it('shares cost and conversation ledger snapshots across clients for 15 seconds', async () => {
    const { getCostsByIssueSnapshot, getConversationLedgerCostsSnapshot } = await import('../dashboard-poll-snapshots.js');
    job.mockImplementation(async operation => operation === 'getCostsByIssueSnapshot'
      ? { status: 'live', eventCount: 0, issues: [] } : [['42', { cost: 8, tokens: 90 }]]);
    const results = await Promise.all([getCostsByIssueSnapshot(), getCostsByIssueSnapshot()]);
    expect(results).toEqual([{ status: 'live', eventCount: 0, issues: [] }, { status: 'live', eventCount: 0, issues: [] }]);
    expect(job).toHaveBeenCalledOnce();
    await expect(getConversationLedgerCostsSnapshot()).resolves.toEqual([['42', { cost: 8, tokens: 90 }]]);
    await getConversationLedgerCostsSnapshot();
    expect(job).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    await getCostsByIssueSnapshot();
    await vi.advanceTimersByTimeAsync(0);
    expect(job).toHaveBeenCalledTimes(3);
  });

  it('shares search stats for 60 seconds and separates database and model changes', async () => {
    const { getConversationSearchStatsSnapshot: get } = await import('../dashboard-poll-snapshots.js');
    const config = { dbPath: '/fixture/search.db', model: 'small' };
    job.mockResolvedValue({ available: true, chunkCount: 9, indexedFileCount: 2, lastIndexedAt: 'today' });
    await Promise.all([get(config), get(config)]);
    expect(job).toHaveBeenCalledOnce();
    expect(job).toHaveBeenCalledWith('getConversationSearchStats', config);
    await vi.advanceTimersByTimeAsync(59_999);
    await get(config);
    expect(job).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await get(config);
    await vi.advanceTimersByTimeAsync(0);
    expect(job).toHaveBeenCalledTimes(2);
    await get({ ...config, model: 'large' });
    await get({ ...config, dbPath: '/fixture/other.db' });
    expect(job).toHaveBeenCalledTimes(4);
  });
});
