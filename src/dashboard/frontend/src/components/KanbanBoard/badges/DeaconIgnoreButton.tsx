import { useState, type MouseEvent } from 'react';
import { Pause } from 'lucide-react';
import { useDashboardStore } from '../../../lib/store';

/**
 * Per-issue "Pause Deacon" toggle. When activated, Deacon patrol skips this
 * issue entirely on every cycle until the operator clicks Resume. Distinct
 * from stuck/unstick — pause is an explicit human opt-out, not a failure
 * recovery path. Rendered prominently on every IssueCard.
 */
export function DeaconIgnoreButton({
  issueIdentifier,
  ignored,
  reason,
}: {
  issueIdentifier: string;
  ignored: boolean;
  reason?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = !ignored;
      const res = await fetch(`/api/workspaces/${encodeURIComponent(issueIdentifier)}/deacon-ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignored: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? res.statusText);
      } else {
        const state = useDashboardStore.getState();
        const upperKey = issueIdentifier.toUpperCase();
        const currentKey = state.reviewStatusByIssueId[upperKey] ? upperKey : issueIdentifier;
        const current = state.reviewStatusByIssueId[currentKey];
        if (current) {
          useDashboardStore.setState((s) => ({
            reviewStatusByIssueId: {
              ...s.reviewStatusByIssueId,
              [currentKey]: {
                ...current,
                deaconIgnored: next || undefined,
                deaconIgnoredAt: next ? new Date().toISOString() : undefined,
                deaconIgnoredReason: next ? current.deaconIgnoredReason : undefined,
              },
            },
          }));
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (ignored) {
    return (
      <span className="flex flex-col gap-0.5">
        <button
          onClick={toggle}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold uppercase tracking-wide bg-purple-900/70 text-purple-100 border border-purple-400/60 hover:bg-purple-800/80 disabled:opacity-60"
          title={reason ? `Deacon paused: ${reason} — click to resume` : 'Deacon paused — click to resume patrol for this issue'}
          data-testid={`card-pause-deacon-${issueIdentifier}`}
        >
          <Pause className="w-3 h-3" />
          Deacon Paused
          <span className="underline ml-1">Resume</span>
        </button>
        {error && <span className="text-xs text-red-400 px-1" title={error}>Failed: {error}</span>}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-0.5">
      <button
        onClick={toggle}
        disabled={busy}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-popover text-muted-foreground border border-white/10 hover:bg-purple-900/40 hover:text-purple-100 hover:border-purple-500/50 disabled:opacity-60"
        title="Tell Deacon to stop patrolling this issue (no re-dispatch, no pokes, no auto-completion)"
        data-testid={`card-pause-deacon-${issueIdentifier}`}
      >
        <Pause className="w-3 h-3" />
        Pause Deacon
      </button>
      {error && <span className="text-xs text-red-400 px-1" title={error}>Failed: {error}</span>}
    </span>
  );
}
