/**
 * AutoMergeToggle — the issue's auto-merge routing key (PAN-1691 / PAN-1692).
 *
 * One shared control, four render sites (slide-out, merge-policy roster,
 * pipeline row, Awaiting Merge).
 *
 * PAN-3917 (D3): the per-issue routing key was a record field and the record is
 * gone. The per-issue override is now the issue's `auto-merge` / `hold-for-uat`
 * tracker label, then the project default, then the global
 * `require_uat_before_merge`. This is a READ-ONLY indicator of the effective
 * key, resolved by GET /api/merge-train/auto-merge. Change the policy through
 * the tracker label, the project (Settings → project → auto-merge default), or
 * globally.
 */
import { Zap, Lock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

const AUTO_MERGE_POLICY_KEY = ['merge-train', 'auto-merge-policy'];

/** PAN-3932: where the value comes from, since clicking the indicator changes nothing. */
const AUTO_MERGE_SOURCE =
  'Read-only. Set by the issue\'s auto-merge or hold-for-uat tracker label, else the project\'s auto-merge default, else the global require-UAT-before-merge setting.';

/** Effective routing key per in-flight issue, shared across every mounted indicator. */
export function useAutoMergePolicyMap(): Record<string, boolean> {
  const { data } = useQuery({
    queryKey: AUTO_MERGE_POLICY_KEY,
    queryFn: async (): Promise<Record<string, boolean>> => {
      const res = await fetch('/api/merge-train/auto-merge');
      if (!res.ok) return {};
      const json = (await res.json()) as { issues?: Array<{ issueId: string; autoMerge: boolean }> };
      return Object.fromEntries(
        (json.issues ?? []).map((entry) => [entry.issueId.toUpperCase(), entry.autoMerge]),
      );
    },
    staleTime: 15_000,
  });
  return data ?? {};
}

export function useAutoMergePolicy(issueId: string): boolean | undefined {
  return useAutoMergePolicyMap()[issueId.toUpperCase()];
}

export interface AutoMergeToggleProps {
  issueId: string;
  /** 'segmented' = Auto/Hold pair (slide-out, Awaiting Merge); 'badge' = single chip (pipeline rows). */
  variant?: 'segmented' | 'badge';
  /** Compact reduces padding/icon size for dense rows. */
  compact?: boolean;
  className?: string;
}

export function AutoMergeToggle({
  issueId,
  variant = 'segmented',
  compact = false,
  className = '',
}: AutoMergeToggleProps) {
  const autoMerge = useAutoMergePolicy(issueId);
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const title = autoMerge === undefined
    ? `Not routed yet — the issue has no open pull request. ${AUTO_MERGE_SOURCE}`
    : autoMerge
      ? `Auto-merge — the train ships this when it is green. ${AUTO_MERGE_SOURCE}`
      : `Hold for UAT — waits for a human batch review. ${AUTO_MERGE_SOURCE}`;

  if (variant === 'badge') {
    const tone = autoMerge === true
      ? 'text-primary bg-primary/[0.08] border-primary/[0.32]'
      : autoMerge === false
        ? 'text-warning-foreground bg-warning/[0.08] border-warning/[0.32]'
        : 'text-muted-foreground bg-transparent border-border';
    return (
      <span
        data-testid="auto-merge-badge"
        title={title}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${tone} ${className}`}
      >
        {autoMerge ? <Zap className={iconSize} /> : <Lock className={iconSize} />}
        {autoMerge === true ? 'auto' : autoMerge === false ? 'hold' : 'default'}
      </span>
    );
  }

  const seg = (active: boolean, tone: string) =>
    `inline-flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} text-xs font-semibold ` +
    (active ? tone : 'text-muted-foreground');

  return (
    <div
      role="group"
      aria-label="Auto-merge policy"
      title={title}
      className={`inline-flex overflow-hidden rounded-lg border border-border bg-background ${className}`}
    >
      <span aria-pressed={autoMerge === true} className={seg(autoMerge === true, 'text-primary bg-primary/[0.08]')}>
        <Zap className={iconSize} /> Auto
      </span>
      <span
        aria-pressed={autoMerge === false}
        className={`border-l border-border ${seg(autoMerge === false, 'text-warning-foreground bg-warning/[0.08]')}`}
      >
        <Lock className={iconSize} /> Hold
      </span>
    </div>
  );
}
