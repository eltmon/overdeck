import { useState } from 'react';
import { XCircle } from 'lucide-react';
import { useDashboardStore } from '../../../lib/store';

/** Diverged badge with Unstick button — shown when main diverged during git push */
export function DivergedBadge({ issueIdentifier, stuckReason, stuckDetails }: { issueIdentifier: string; stuckReason?: string | null; stuckDetails?: string | null }) {
  const [unstickError, setUnstickError] = useState<string | null>(null);

  // Parse SHA details stored by pushApproveMain when MainDivergedError was thrown
  let shaInfo = '';
  if (stuckDetails) {
    try {
      const d = JSON.parse(stuckDetails) as Record<string, unknown>;
      const local = typeof d.localSha === 'string' ? d.localSha.slice(0, 7) : null;
      const remote = typeof d.remoteSha === 'string' ? d.remoteSha.slice(0, 7) : null;
      if (local && remote) shaInfo = ` (local: ${local}, remote: ${remote})`;
      else if (remote) shaInfo = ` (remote: ${remote})`;
    } catch { /* ignore malformed details */ }
  }

  const titleText = stuckReason
    ? `Push blocked: ${stuckReason}${shaInfo}. Run: git reset --hard origin/main, then click Unstick to retry.`
    : `Push blocked due to divergence from origin/main${shaInfo}. Run: git reset --hard origin/main, then click Unstick to retry.`;

  return (
    <span className="flex flex-col gap-0.5">
      <span
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-900/70 text-red-300 border border-red-500/60"
        title={titleText}
      >
        <XCircle className="w-3 h-3" />
        Diverged
        <button
          className="ml-1 underline text-red-200 hover:text-foreground text-xs leading-none"
          onClick={async (e) => {
            e.stopPropagation();
            setUnstickError(null);
            try {
              const res = await fetch(`/api/workspaces/${encodeURIComponent(issueIdentifier)}/unstick`, { method: 'POST' });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setUnstickError(body.error ?? res.statusText);
              } else {
                // Optimistic update: mirror what the server resets so the badge
                // disappears immediately without waiting for the WS round-trip.
                // Server sets: stuck=false, reviewStatus/testStatus/mergeStatus='pending', readyForMerge=false.
                const state = useDashboardStore.getState();
                const upperKey = issueIdentifier.toUpperCase();
                const current = state.reviewStatusByIssueId[upperKey]
                  ?? state.reviewStatusByIssueId[issueIdentifier];
                if (current) {
                  const key = state.reviewStatusByIssueId[upperKey] ? upperKey : issueIdentifier;
                  // Optimistic update: clear stuck fields and reset lifecycle.
                  // Recovery requires `git reset --hard origin/main`, making prior results invalid.
                  // The WS status_changed event from the server will reconcile the full state.
                  useDashboardStore.setState((s) => ({
                    reviewStatusByIssueId: {
                      ...s.reviewStatusByIssueId,
                      [key]: {
                        ...current,
                        stuck: undefined,
                        stuckReason: undefined,
                        stuckDetails: undefined,
                        reviewStatus: 'pending',
                        testStatus: 'pending',
                        mergeStatus: 'pending',
                        readyForMerge: false,
                      },
                    },
                  }));
                }
              }
            } catch (err: unknown) {
              setUnstickError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Unstick
        </button>
      </span>
      {unstickError && (
        <span className="text-xs text-red-400 px-1" title={unstickError}>
          Unstick failed: {unstickError}
        </span>
      )}
    </span>
  );
}
