/**
 * Pending auto-merges (PAN-3964 FR-11; v1 `PendingAutoMergesBanner`). Reads
 * the merge train's cooldown queue and lets the operator cancel an entry
 * before its countdown runs out. Hidden when nothing is pending.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { RailCard } from './primitives';

export interface PendingAutoMergeRow {
  id: number;
  issueId: string;
  prUrl: string;
  prNumber?: number;
  scheduledMergeAt: string;
  status: 'pending' | 'merging' | 'blocked' | 'failed' | 'merged' | 'cancelled';
}

export const PENDING_AUTO_MERGES_QUERY_KEY = ['merge-train', 'auto-merge', 'pending'] as const;

async function fetchPending(): Promise<PendingAutoMergeRow[]> {
  const res = await fetch('/api/merge-train/auto-merge/pending');
  if (!res.ok) throw new Error(`GET /api/merge-train/auto-merge/pending → ${res.status}`);
  return res.json() as Promise<PendingAutoMergeRow[]>;
}

export function formatAutoMergeCountdown(scheduledMergeAt: string, nowMs: number): string {
  const remainingMs = Date.parse(scheduledMergeAt) - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'merging…';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  return `auto-merging in ${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function prLabel(entry: PendingAutoMergeRow): string {
  if (entry.prNumber) return `PR #${entry.prNumber}`;
  const match = entry.prUrl.match(/\/(?:pull|merge_requests)\/(\d+)(?:$|[/?#])/);
  return match ? `PR #${match[1]}` : 'PR';
}

export function PendingAutoMergesCard({ onNavigateIssue }: { onNavigateIssue?: (issueId: string) => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: PENDING_AUTO_MERGES_QUERY_KEY, queryFn: fetchPending, refetchInterval: 5_000 });
  const cancel = useMutation({
    mutationFn: async (issueId: string) => {
      const res = await fetch(`/api/merge-train/auto-merge/${encodeURIComponent(issueId)}`, {
        method: 'DELETE',
        headers: await dashboardMutationJsonHeaders(),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => '')) || `DELETE auto-merge ${issueId} → ${res.status}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: PENDING_AUTO_MERGES_QUERY_KEY }),
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const pending = Array.isArray(data) ? data.filter((entry) => entry.status === 'pending' || entry.status === 'merging') : [];

  useEffect(() => {
    if (pending.length === 0) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [pending.length]);

  if (pending.length === 0) return null;

  return (
    <RailCard label="Pending auto-merges" ariaLabel="Pending auto-merges">
      <ul className="space-y-1.5">
        {pending.map((entry) => {
          const merging = entry.status === 'merging' || Date.parse(entry.scheduledMergeAt) <= nowMs;
          return (
            <li key={entry.id} className="flex flex-wrap items-center gap-2 text-xs" data-testid={`pending-auto-merge-${entry.issueId}`}>
              <button type="button" className="font-mono text-foreground hover:underline" onClick={() => onNavigateIssue?.(entry.issueId)}>
                {entry.issueId}
              </button>
              <a href={entry.prUrl} target="_blank" rel="noreferrer" className="font-mono text-muted-foreground hover:underline">{prLabel(entry)}</a>
              <span className="font-mono text-warning-foreground">{merging ? 'merging…' : formatAutoMergeCountdown(entry.scheduledMergeAt, nowMs)}</span>
              <button
                type="button"
                disabled={merging || cancel.isPending}
                onClick={() => cancel.mutate(entry.issueId)}
                className="ml-auto rounded-sm border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </li>
          );
        })}
      </ul>
      {cancel.error && <p className="mt-2 text-xs text-destructive" role="alert">{cancel.error.message}</p>}
    </RailCard>
  );
}
