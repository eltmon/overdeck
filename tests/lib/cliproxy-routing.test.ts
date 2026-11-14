import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolAccount, PoolAccountList, PoolSnapshot } from '../../src/lib/cliproxy-pool.js';

const pool = vi.hoisted(() => ({
  listPoolAccounts: vi.fn<() => Promise<PoolAccountList>>(),
  readPool: vi.fn<() => Promise<PoolSnapshot>>(),
  setAccountPriority: vi.fn<(name: string, priority: number) => Promise<void>>(),
}));
vi.mock('../../src/lib/cliproxy-pool.js', () => pool);

const {
  planPriorities,
  refreshPool,
  readPoolSnapshot,
  getPoolSnapshot,
  startCliproxyRoutingController,
  ROUTING_FIRST_TICK_MS,
  ROUTING_INTERVAL_MS,
} = await import('../../src/lib/cliproxy-routing.js');

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-11-14T12:00:00.000Z');

function account(name: string, overrides: Partial<PoolAccount> & { resetInDays?: number; used?: number } = {}): PoolAccount {
  const { resetInDays = 3, used = 10, ...rest } = overrides;
  const resetsAt = new Date(NOW + resetInDays * DAY_MS).toISOString();
  return {
    name,
    authIndex: name,
    provider: 'codex',
    email: null,
    plan: 'pro',
    disabled: false,
    priority: null,
    windows: [{ label: 'weekly', usedPercent: used, resetsAt, windowSeconds: 604800 }],
    weeklyResetsAt: resetsAt,
    exhausted: false,
    error: null,
    usageRead: true,
    ...rest,
  };
}

describe('planPriorities', () => {
  it('soonest weekly reset gets the highest priority', () => {
    const plan = planPriorities([
      account('later.json', { resetInDays: 4 }),
      account('sooner.json', { resetInDays: 1 }),
    ]);

    expect(Object.fromEntries(plan)).toEqual({ 'sooner.json': 20, 'later.json': 10 });
  });

  it('ties go to lower used percent, then auth_index', () => {
    const byUsed = planPriorities([
      account('busy.json', { used: 60 }),
      account('idle.json', { used: 5 }),
    ]);
    expect(Object.fromEntries(byUsed)).toEqual({ 'idle.json': 20, 'busy.json': 10 });

    const byIndex = planPriorities([
      account('b.json', { authIndex: 'bb' }),
      account('a.json', { authIndex: 'aa' }),
    ]);
    expect(Object.fromEntries(byIndex)).toEqual({ 'a.json': 20, 'b.json': 10 });
  });

  it('exhausted accounts get priority 0', () => {
    const plan = planPriorities([
      account('spent.json', { resetInDays: 0.5, exhausted: true }),
      account('one.json', { resetInDays: 1 }),
      account('two.json', { resetInDays: 2 }),
    ]);

    expect(Object.fromEntries(plan)).toEqual({ 'spent.json': 0, 'one.json': 20, 'two.json': 10 });
  });

  it('fewer than two eligible accounts writes nothing', () => {
    expect(planPriorities([account('only.json')]).size).toBe(0);
    expect(planPriorities([]).size).toBe(0);
  });

  it('accounts with a read error or disabled are untouched', () => {
    const plan = planPriorities([
      account('ok.json'),
      account('off.json', { disabled: true, usageRead: false }),
      account('broken.json', { error: 'HTTP 429 from provider', windows: [], weeklyResetsAt: null }),
    ]);

    expect(plan.size).toBe(0);
  });

  it('skips untouched accounts while ranking the eligible ones', () => {
    const plan = planPriorities([
      account('one.json', { resetInDays: 1 }),
      account('two.json', { resetInDays: 2 }),
      account('off.json', { disabled: true, usageRead: false, priority: 99 }),
      account('no-weekly.json', { windows: [], weeklyResetsAt: null, priority: 5 }),
    ]);

    expect(Object.fromEntries(plan)).toEqual({ 'one.json': 20, 'two.json': 10 });
  });

  it('returns only changed priorities', () => {
    const plan = planPriorities([
      account('one.json', { resetInDays: 1, priority: 20 }),
      account('two.json', { resetInDays: 2, priority: 30 }),
    ]);

    expect(Object.fromEntries(plan)).toEqual({ 'two.json': 10 });
  });

  it('ranks each provider separately and never ranks gemini', () => {
    const plan = planPriorities([
      account('codex-a.json', { resetInDays: 1 }),
      account('codex-b.json', { resetInDays: 2 }),
      account('claude-a.json', { provider: 'claude', resetInDays: 5 }),
      account('claude-b.json', { provider: 'claude', resetInDays: 3 }),
      account('gemini-a.json', { provider: 'gemini', resetInDays: 1 }),
      account('gemini-b.json', { provider: 'gemini', resetInDays: 2 }),
    ]);

    expect(Object.fromEntries(plan)).toEqual({
      'codex-a.json': 20,
      'codex-b.json': 10,
      'claude-b.json': 20,
      'claude-a.json': 10,
    });
  });
});

function snapshotOf(accounts: PoolAccount[]): PoolSnapshot {
  return { checkedAt: '2026-11-14T12:00:00.000Z', managementAvailable: true, accounts };
}

const SECRET_KEY = ['mgmt', 'routing', 'fixture'].join('-');

describe('refreshPool and readPoolSnapshot', () => {
  beforeEach(() => {
    pool.readPool.mockReset();
    pool.setAccountPriority.mockReset();
    pool.setAccountPriority.mockResolvedValue(undefined);
  });

  it('applies the other changes when one PATCH fails and keeps the old priority for it', async () => {
    pool.readPool.mockResolvedValue(snapshotOf([
      account('one.json', { resetInDays: 1, priority: 5 }),
      account('two.json', { resetInDays: 2, priority: 7 }),
    ]));
    pool.setAccountPriority.mockImplementation(async (name) => {
      if (name === 'one.json') throw new Error(`HTTP 500 with ${SECRET_KEY}`);
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const snapshot = await refreshPool();

    expect(pool.setAccountPriority.mock.calls).toEqual([['one.json', 20], ['two.json', 10]]);
    expect(snapshot.accounts.map((entry) => [entry.name, entry.priority]))
      .toEqual([['one.json', 5], ['two.json', 10]]);
    expect(getPoolSnapshot()).toBe(snapshot);
    const logged = errors.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('[cliproxy-routing] priority update failed for one.json');
    expect(logged).not.toContain(SECRET_KEY);
    errors.mockRestore();
  });

  it('readPoolSnapshot stores the snapshot and never sets a priority', async () => {
    const fresh = snapshotOf([
      account('one.json', { resetInDays: 1 }),
      account('two.json', { resetInDays: 2 }),
    ]);
    pool.readPool.mockResolvedValue(fresh);

    await expect(readPoolSnapshot()).resolves.toBe(fresh);

    expect(getPoolSnapshot()).toBe(fresh);
    expect(pool.setAccountPriority).not.toHaveBeenCalled();
  });
});

describe('startCliproxyRoutingController', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    pool.listPoolAccounts.mockReset();
    pool.readPool.mockReset();
    pool.setAccountPriority.mockReset();
    pool.setAccountPriority.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  const twoCodex = () => [
    account('sooner.json', { resetInDays: 1 }),
    account('later.json', { resetInDays: 4 }),
  ];

  it('controller ticks at 10s then every 5 minutes and skips overlapping ticks', async () => {
    pool.listPoolAccounts.mockResolvedValue({ managementAvailable: true, accounts: twoCodex() });
    pool.readPool.mockResolvedValue(snapshotOf(twoCodex()));

    stop = startCliproxyRoutingController();
    await vi.advanceTimersByTimeAsync(ROUTING_FIRST_TICK_MS - 1);
    expect(pool.readPool).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pool.readPool).toHaveBeenCalledTimes(1);
    expect(pool.setAccountPriority.mock.calls).toEqual([['sooner.json', 20], ['later.json', 10]]);

    await vi.advanceTimersByTimeAsync(ROUTING_INTERVAL_MS - ROUTING_FIRST_TICK_MS);
    expect(pool.readPool).toHaveBeenCalledTimes(2);
  });

  it('does not start a second read while a tick is still in flight', async () => {
    pool.listPoolAccounts.mockResolvedValue({ managementAvailable: true, accounts: twoCodex() });
    let release: (snapshot: PoolSnapshot) => void = () => {};
    pool.readPool.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    pool.readPool.mockResolvedValue(snapshotOf(twoCodex()));

    stop = startCliproxyRoutingController();
    await vi.advanceTimersByTimeAsync(ROUTING_FIRST_TICK_MS);
    expect(pool.readPool).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(ROUTING_INTERVAL_MS);
    expect(pool.readPool).toHaveBeenCalledTimes(1);

    release(snapshotOf(twoCodex()));
    await vi.advanceTimersByTimeAsync(ROUTING_INTERVAL_MS);
    expect(pool.readPool).toHaveBeenCalledTimes(2);
  });

  it('controller makes no usage reads when no provider has two enabled accounts', async () => {
    pool.listPoolAccounts.mockResolvedValue({
      managementAvailable: true,
      accounts: [
        account('codex-primary.json'),
        account('codex-off.json', { disabled: true }),
        account('gemini-a.json', { provider: 'gemini' }),
        account('gemini-b.json', { provider: 'gemini' }),
      ],
    });

    stop = startCliproxyRoutingController();
    await vi.advanceTimersByTimeAsync(ROUTING_FIRST_TICK_MS + 2 * ROUTING_INTERVAL_MS);

    expect(pool.listPoolAccounts).toHaveBeenCalledTimes(3);
    expect(pool.readPool).not.toHaveBeenCalled();
    expect(pool.setAccountPriority).not.toHaveBeenCalled();
  });

  it('logs and survives a failing tick', async () => {
    pool.listPoolAccounts.mockRejectedValueOnce(new Error('boom'));
    pool.listPoolAccounts.mockResolvedValue({ managementAvailable: true, accounts: twoCodex() });
    pool.readPool.mockResolvedValue(snapshotOf(twoCodex()));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    stop = startCliproxyRoutingController();
    await vi.advanceTimersByTimeAsync(ROUTING_FIRST_TICK_MS);
    expect(errors).toHaveBeenCalledWith('[cliproxy-routing] refresh failed:', 'boom');
    await vi.advanceTimersByTimeAsync(ROUTING_INTERVAL_MS);
    expect(pool.readPool).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });
});
