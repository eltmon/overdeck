/**
 * CliproxyAccountsPanel — read-only view of the CLIProxy account pool
 * (PAN-5278): one row per account with its usage windows, its reset-first
 * routing rank, and its state. Data comes from GET /api/cliproxy/accounts,
 * which the host dashboard's routing controller keeps in memory.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import {
  fetchCliproxyAccounts,
  type CliproxyPoolAccount,
  type CliproxyPoolSnapshot,
  type CliproxyPoolWindow,
} from '../../../App/api';
import { ProviderLogo } from '../../shared/branding';
import { SensitiveText } from '../../SensitiveText';

const RANKED_PROVIDERS = new Set(['codex', 'claude']);
/** CLIProxy provider names → the dashboard's brand keys, for the logo. */
const LOGO_PROVIDER: Record<string, string> = { codex: 'openai', claude: 'anthropic' };
const ORDINALS = ['next', '2nd', '3rd'];

function ordinal(position: number): string {
  if (position < ORDINALS.length) return ORDINALS[position];
  return `${position + 1}th`;
}

/** "6d 5h", "3h 20m", "12m", or "now". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(mins, 1)}m`;
}

function windowText(window: CliproxyPoolWindow, now: number): string {
  const used = `${window.label} ${Math.round(window.usedPercent)}%`;
  if (!window.resetsAt) return used;
  const ms = Date.parse(window.resetsAt) - now;
  return ms > 0 ? `${used} · resets in ${formatDuration(ms)}` : `${used} · resets now`;
}

function checkedText(checkedAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(checkedAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'checked just now';
  if (minutes < 60) return `checked ${minutes} min ago`;
  return `checked ${Math.floor(minutes / 60)} h ago`;
}

/**
 * Rank label per account name: "next" for its provider's highest priority,
 * then "2nd", "3rd", …; "last resort" for priority 0. Only ranked providers
 * with 2+ accounts get a rank.
 */
function rankLabels(accounts: readonly CliproxyPoolAccount[]): Map<string, string> {
  const labels = new Map<string, string>();
  const byProvider = new Map<string, CliproxyPoolAccount[]>();
  for (const account of accounts) {
    if (!RANKED_PROVIDERS.has(account.provider)) continue;
    byProvider.set(account.provider, [...(byProvider.get(account.provider) ?? []), account]);
  }
  for (const group of byProvider.values()) {
    if (group.length < 2) continue;
    const ranked = group
      .filter((account) => !account.disabled && account.priority !== null && account.priority > 0)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    ranked.forEach((account, index) => labels.set(account.name, ordinal(index)));
    for (const account of group) {
      if (!account.disabled && account.priority === 0) labels.set(account.name, 'last resort');
    }
  }
  return labels;
}

function stateText(account: CliproxyPoolAccount): string | null {
  if (account.disabled) return 'disabled';
  if (!account.usageRead) return 'usage not read';
  if (account.error) return account.error;
  if (account.exhausted) return 'exhausted';
  return null;
}

function singleAccountProviders(accounts: readonly CliproxyPoolAccount[]): string[] {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    if (!RANKED_PROVIDERS.has(account.provider)) continue;
    counts.set(account.provider, (counts.get(account.provider) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count === 1).map(([provider]) => provider);
}

function AccountRow({ account, rank, now }: { account: CliproxyPoolAccount; rank: string | undefined; now: number }) {
  const state = stateText(account);
  return (
    <div className="px-3 py-2.5 border-b border-border last:border-b-0" data-testid="cliproxy-account-row">
      <div className="flex items-center gap-3">
        <ProviderLogo provider={LOGO_PROVIDER[account.provider] ?? account.provider} label={account.provider} className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground">{account.provider}</span>
        {account.email ? (
          <SensitiveText value={account.email} className="text-xs text-foreground" />
        ) : (
          <span className="text-xs font-mono text-muted-foreground">{account.name}</span>
        )}
        {account.plan && <span className="text-xs text-muted-foreground">{account.plan}</span>}
        <span className="flex-1" />
        {rank && <span className="text-xs text-foreground" data-testid="cliproxy-account-rank">{rank}</span>}
        {state && (
          <span className={`text-xs ${account.exhausted && !account.disabled && !account.error ? 'text-warning' : 'text-muted-foreground'}`}>
            {state}
          </span>
        )}
      </div>
      {account.windows.length > 0 && (
        <div className="mt-2 ml-7 space-y-1.5">
          {account.windows.map((window) => (
            <div key={window.label} className="flex items-center gap-3">
              <div className="h-1 w-24 shrink-0 rounded-sm bg-border overflow-hidden" aria-hidden="true">
                <div
                  className="h-full bg-muted-foreground"
                  style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">{windowText(window, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CliproxyAccountsPanel() {
  const [snapshot, setSnapshot] = useState<CliproxyPoolSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    try {
      setSnapshot(await fetchCliproxyAccounts(refresh));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const now = Date.now();
  const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
  const ranks = rankLabels(accounts);
  const single = singleAccountProviders(accounts);

  return (
    <div className="mt-6" data-testid="cliproxy-accounts-panel">
      <div className="flex items-center justify-between gap-4 mb-1">
        <h3 className="text-sm font-medium text-foreground">CLIProxy accounts</h3>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        New sessions go to the account whose weekly quota resets soonest. Sessions already running stay on their account.
      </p>
      {error && <p className="text-xs text-muted-foreground">{error}</p>}
      {snapshot && !snapshot.managementAvailable && (
        <p className="text-xs text-muted-foreground">CLIProxy management API is off</p>
      )}
      {snapshot && snapshot.managementAvailable && (
        <>
          <p className="text-xs text-muted-foreground mb-2">{checkedText(snapshot.checkedAt, now)}</p>
          {accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No accounts in the pool.</p>
          ) : (
            <div className="rounded-lg border border-border">
              {accounts.map((account) => (
                <AccountRow key={account.name} account={account} rank={ranks.get(account.name)} now={now} />
              ))}
            </div>
          )}
          {single.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">Add a second account to use reset-first routing.</p>
          )}
        </>
      )}
    </div>
  );
}
