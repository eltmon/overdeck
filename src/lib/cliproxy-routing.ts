/**
 * cliproxy-routing.ts
 *
 * Reset-first routing for the CLIProxy account pool (PAN-5278). CLIProxy picks
 * from the highest-priority tier of a provider's accounts, so Overdeck gets
 * reset-first routing by setting per-account `priority`: inside each provider
 * the account whose weekly window resets soonest ranks highest, which spends
 * quota that would otherwise be lost at the reset.
 *
 * This module owns `priority` on every eligible `codex` and `claude` account
 * (enabled, usage read without error, weekly window known). It never touches a
 * disabled account or one whose usage could not be read; to take an account
 * out of rotation, set `disabled: true` on it.
 *
 * The controller (`startCliproxyRoutingController`, host dashboards only) runs
 * 10 seconds after start and then every 5 minutes. A tick lists the accounts
 * locally and reads upstream usage only when a ranked provider has 2+ enabled
 * accounts; with one account, ranking cannot change anything. `refreshPool` is
 * the only caller of `setAccountPriority`. The snapshot lives in memory only.
 *
 * It never logs or stores the management key, tokens or upstream text; the
 * snapshot it keeps comes from `cliproxy-pool.ts`, which already excludes them.
 */

import {
  listPoolAccounts,
  readPool,
  setAccountPriority,
  type PoolAccount,
  type PoolSnapshot,
} from './cliproxy-pool.js';

const RANKED_PROVIDERS = ['codex', 'claude'] as const;
const PRIORITY_STEP = 10;
const EXHAUSTED_PRIORITY = 0;

function isEligible(account: PoolAccount): boolean {
  return !account.disabled
    && account.usageRead
    && account.error === null
    && account.weeklyResetsAt !== null;
}

function weeklyUsedPercent(account: PoolAccount): number {
  // The weekly window is the longest one (cliproxy-pool.ts picks it the same way).
  let weekly: PoolAccount['windows'][number] | null = null;
  for (const window of account.windows) {
    if (window.windowSeconds === null) continue;
    if (!weekly || window.windowSeconds > (weekly.windowSeconds ?? 0)) weekly = window;
  }
  return weekly?.usedPercent ?? 0;
}

function compareResetFirst(a: PoolAccount, b: PoolAccount): number {
  const byReset = Date.parse(a.weeklyResetsAt ?? '') - Date.parse(b.weeklyResetsAt ?? '');
  if (byReset !== 0) return byReset;
  const byUsed = weeklyUsedPercent(a) - weeklyUsedPercent(b);
  if (byUsed !== 0) return byUsed;
  return a.authIndex < b.authIndex ? -1 : a.authIndex > b.authIndex ? 1 : 0;
}

/**
 * Pure. Returns the priority to set per account name, only for accounts whose
 * priority must change. Per ranked provider with 2+ eligible accounts, the
 * non-exhausted ones get n*10 down to 10 in reset-first order and the
 * exhausted ones get 0 (CLIProxy uses them only when nothing else is left).
 */
export function planPriorities(accounts: readonly PoolAccount[]): Map<string, number> {
  const changes = new Map<string, number>();
  for (const provider of RANKED_PROVIDERS) {
    const eligible = accounts.filter((account) => account.provider === provider && isEligible(account));
    if (eligible.length < 2) continue;

    const ranked = eligible.filter((account) => !account.exhausted).sort(compareResetFirst);
    const desired = new Map<PoolAccount, number>();
    ranked.forEach((account, index) => {
      desired.set(account, (ranked.length - index) * PRIORITY_STEP);
    });
    for (const account of eligible) {
      if (account.exhausted) desired.set(account, EXHAUSTED_PRIORITY);
    }

    for (const [account, priority] of desired) {
      if (account.priority !== priority) changes.set(account.name, priority);
    }
  }
  return changes;
}

export const ROUTING_FIRST_TICK_MS = 10_000;
export const ROUTING_INTERVAL_MS = 5 * 60_000;

let lastSnapshot: PoolSnapshot | null = null;

/** The latest pool snapshot this dashboard read, or null before the first read. */
export function getPoolSnapshot(): PoolSnapshot | null {
  return lastSnapshot;
}

/** Read the pool and store the snapshot. Never changes a priority. */
export async function readPoolSnapshot(): Promise<PoolSnapshot> {
  const snapshot = await readPool();
  lastSnapshot = snapshot;
  return snapshot;
}

/**
 * Read the pool, set every priority planPriorities says must change (one
 * PATCH at a time), store the snapshot with the applied priorities, and return
 * it. A failed PATCH is logged by account name only and leaves that account's
 * priority as it was.
 */
export async function refreshPool(): Promise<PoolSnapshot> {
  const snapshot = await readPool();
  const changes = planPriorities(snapshot.accounts);
  const applied = new Map<string, number>();
  for (const [name, priority] of changes) {
    try {
      await setAccountPriority(name, priority);
      applied.set(name, priority);
    } catch {
      console.error(`[cliproxy-routing] priority update failed for ${name}`);
    }
  }
  const updated: PoolSnapshot = {
    ...snapshot,
    accounts: snapshot.accounts.map((account) =>
      applied.has(account.name) ? { ...account, priority: applied.get(account.name) ?? null } : account,
    ),
  };
  lastSnapshot = updated;
  return updated;
}

function someProviderHasTwoEnabled(accounts: readonly PoolAccount[]): boolean {
  return RANKED_PROVIDERS.some((provider) =>
    accounts.filter((account) => account.provider === provider && !account.disabled).length >= 2,
  );
}

/**
 * Start the reset-first routing controller: one tick 10 s after start, then
 * one every 5 minutes. A tick that starts while another runs is skipped.
 * Errors are logged, never thrown. Returns a function that stops the timers.
 */
export function startCliproxyRoutingController(): () => void {
  let tickInFlight = false;

  async function tick(): Promise<void> {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const list = await listPoolAccounts();
      if (!list.managementAvailable || !someProviderHasTwoEnabled(list.accounts)) return;
      await refreshPool();
    } catch (err) {
      console.error(
        '[cliproxy-routing] refresh failed:',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      tickInFlight = false;
    }
  }

  const firstTick = setTimeout(() => void tick(), ROUTING_FIRST_TICK_MS);
  const interval = setInterval(() => void tick(), ROUTING_INTERVAL_MS);
  // The controller never keeps a process alive on its own.
  firstTick.unref?.();
  interval.unref?.();
  return () => {
    clearTimeout(firstTick);
    clearInterval(interval);
  };
}
