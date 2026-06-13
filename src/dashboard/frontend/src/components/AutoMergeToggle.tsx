/**
 * AutoMergeToggle — per-issue auto-merge routing-key control (PAN-1691 / PAN-1692).
 *
 * One shared control, four render sites (slide-out, flywheel roster, pipeline
 * row, Awaiting Merge). Posts to the single endpoint
 *   POST /api/workspaces/:id/auto-merge { autoMerge: boolean }
 * and optimistically patches the store (the server also emits status_changed
 * for cross-client sync — see setAutoMerge in review-status.ts).
 *
 * Tri-state semantics: `undefined` = follow project default, `true` = auto-merge
 * (fast lane), `false` = hold for UAT (manual lane).
 */
import { useState } from 'react';
import { Zap, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useDashboardStore } from '../lib/store';

async function postAutoMerge(issueId: string, autoMerge: boolean): Promise<void> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(issueId)}/auto-merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoMerge }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
}

/** Optimistically patch the store so the toggle reflects instantly (mirrors the deacon-ignore pattern). */
function patchStore(issueId: string, autoMerge: boolean): void {
  const state = useDashboardStore.getState();
  const upperKey = issueId.toUpperCase();
  const currentKey = state.reviewStatusByIssueId[upperKey] ? upperKey : issueId;
  const current = state.reviewStatusByIssueId[currentKey];
  if (!current) return;
  useDashboardStore.setState((s) => ({
    reviewStatusByIssueId: {
      ...s.reviewStatusByIssueId,
      [currentKey]: { ...current, autoMerge },
    },
  }));
}

/**
 * The global "Require UAT before merge" setting — what the `default` (unset)
 * state resolves to. Cached/shared across every toggle via react-query.
 */
function useRequireUatDefault(): boolean | undefined {
  const { data } = useQuery({
    queryKey: ['flywheel', 'config', 'require-uat'],
    queryFn: async (): Promise<boolean | undefined> => {
      const res = await fetch('/api/flywheel/config');
      if (!res.ok) return undefined;
      const json = (await res.json()) as { require_uat_before_merge?: unknown };
      return Boolean(json.require_uat_before_merge);
    },
    staleTime: 30_000,
  });
  return data;
}

export interface AutoMergeToggleProps {
  issueId: string;
  /** Current routing key. undefined = follow project default. */
  autoMerge: boolean | undefined;
  /** 'segmented' = Auto/Hold pair (slide-out, Awaiting Merge); 'badge' = single click-to-flip chip (pipeline rows). */
  variant?: 'segmented' | 'badge';
  /** Compact reduces padding/icon size for dense rows. */
  compact?: boolean;
  className?: string;
}

export function AutoMergeToggle({
  issueId,
  autoMerge,
  variant = 'segmented',
  compact = false,
  className = '',
}: AutoMergeToggleProps) {
  const [busy, setBusy] = useState(false);
  const requireUatDefault = useRequireUatDefault();
  const defaultResolvesTo =
    requireUatDefault === undefined ? 'the project default'
      : requireUatDefault ? 'hold for UAT'
        : 'auto-merge';

  const set = async (next: boolean) => {
    if (busy || autoMerge === next) return;
    setBusy(true);
    try {
      await postAutoMerge(issueId, next);
      patchStore(issueId, next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update auto-merge');
    } finally {
      setBusy(false);
    }
  };

  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';

  if (variant === 'badge') {
    const isAuto = autoMerge === true;
    const next = !isAuto; // undefined/false → set auto; true → set hold
    const label = isAuto ? 'auto' : autoMerge === false ? 'hold' : 'default';
    const tone = isAuto
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/40'
      : autoMerge === false
        ? 'text-amber-400 bg-amber-500/10 border-amber-500/40'
        : 'text-muted-foreground bg-transparent border-border';
    return (
      <button
        type="button"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); void set(next); }}
        title={
          isAuto ? 'Auto-merge ON — click to hold for UAT'
            : autoMerge === false ? 'Holding for UAT — click to auto-merge'
              : `Follows the global default (currently: ${defaultResolvesTo}) — click to set Auto`
        }
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold transition disabled:opacity-50 hover:brightness-110 ${tone} ${className}`}
      >
        {isAuto ? <Zap className={iconSize} /> : <Lock className={iconSize} />}
        {label}
      </button>
    );
  }

  // segmented
  const seg = (active: boolean, tone: string) =>
    `inline-flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} text-xs font-semibold transition disabled:opacity-50 ` +
    (active ? tone : 'text-muted-foreground hover:text-foreground hover:bg-accent/40');

  return (
    <div
      role="group"
      aria-label="Auto-merge policy"
      title={autoMerge === undefined ? `Default follows the global setting (currently: ${defaultResolvesTo})` : undefined}
      className={`inline-flex overflow-hidden rounded-lg border border-border bg-background ${className}`}
    >
      <button
        type="button"
        disabled={busy}
        aria-pressed={autoMerge === true}
        onClick={(e) => { e.stopPropagation(); void set(true); }}
        className={seg(autoMerge === true, 'text-emerald-400 bg-emerald-500/10')}
        title="Auto-merge — ride the train, ship when green"
      >
        <Zap className={iconSize} /> Auto
      </button>
      <button
        type="button"
        disabled={busy}
        aria-pressed={autoMerge === false}
        onClick={(e) => { e.stopPropagation(); void set(false); }}
        className={`border-l border-border ${seg(autoMerge === false, 'text-amber-400 bg-amber-500/10')}`}
        title="Hold for UAT — wait for human batch review"
      >
        <Lock className={iconSize} /> Hold
      </button>
    </div>
  );
}
