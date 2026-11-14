import { describe, expect, it } from 'vitest';
import type { PoolAccount } from '../../src/lib/cliproxy-pool.js';
import { planPriorities } from '../../src/lib/cliproxy-routing.js';

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
