import { useState } from 'react';
import { XCircle } from 'lucide-react';
import { useDashboardStore } from '../../../lib/store';

/**
 * PAN-794: Review-infrastructure breaker badge.
 *
 * Shown when the deacon trips the circuit breaker after repeated
 * parallel-review re-dispatch failures. Clicking Retry calls the unstick
 * endpoint, which skips the git-safe-state check for this reason and opens a
 * fresh recovery cycle.
 */
export function ReviewInfraStuckBadge({ issueIdentifier, retries, recoveryStartedAt }: { issueIdentifier: string; retries: number; recoveryStartedAt?: string }) {
  const [unstickError, setUnstickError] = useState<string | null>(null);

  const recoveryAge = recoveryStartedAt
    ? Math.floor((Date.now() - new Date(recoveryStartedAt).getTime()) / 60_000)
    : undefined;
  const recoveryAgeLabel = recoveryAge != null
    ? recoveryAge >= 60 ? `${Math.floor(recoveryAge / 60)}h ${recoveryAge % 60}m` : `${recoveryAge}m`
    : undefined;

  const titleText =
    `Review infrastructure failed after ${retries} retries (spawn/dispatch issue). ` +
    (recoveryAgeLabel ? `Recovery cycle running for ${recoveryAgeLabel}. ` : '') +
    `Parallel review is paused — click Retry to open a fresh recovery cycle.`;

  return (
    <span className="flex flex-col gap-0.5">
      <span
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900/70 text-amber-200 border border-amber-500/60"
        title={titleText}
      >
        <XCircle className="w-3 h-3" />
        Review stuck{recoveryAgeLabel && <span className="text-amber-400/80 ml-0.5">({recoveryAgeLabel})</span>}
        <button
          className="ml-1 underline text-amber-100 hover:text-foreground text-xs leading-none"
          onClick={async (e) => {
            e.stopPropagation();
            setUnstickError(null);
            try {
              const res = await fetch(`/api/workspaces/${encodeURIComponent(issueIdentifier)}/unstick`, { method: 'POST' });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setUnstickError(body.error ?? res.statusText);
              } else {
                const state = useDashboardStore.getState();
                const upperKey = issueIdentifier.toUpperCase();
                const current = state.reviewStatusByIssueId[upperKey]
                  ?? state.reviewStatusByIssueId[issueIdentifier];
                if (current) {
                  const key = state.reviewStatusByIssueId[upperKey] ? upperKey : issueIdentifier;
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
                        reviewRetryCount: 0,
                        recoveryStartedAt: undefined,
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
          Retry
        </button>
      </span>
      {unstickError && (
        <span className="text-xs text-red-400 px-1" title={unstickError}>
          Retry failed: {unstickError}
        </span>
      )}
    </span>
  );
}
