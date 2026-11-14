/**
 * The recent merges strip (PAN-4753 WI-10, FR-16, R8): one line naming the
 * last merge, expanding to the last five and how each landed, including
 * merges made outside the train (noted, never treated as errors).
 */
import { useState } from 'react';
import type { RecentMerge } from './boardTypes';
import {
  HIDE_RECENT_LABEL,
  LAST_MERGED_LABEL,
  formatAgo,
  recentVia,
  showRecentLabel,
} from './trainCopy';
import { useNow } from './useMergeTrainBoard';

export function RecentMergesStrip({ recent }: { recent: readonly RecentMerge[] }) {
  const [open, setOpen] = useState(false);
  const now = useNow(60_000);
  const last = recent[0];
  if (!last) return null;
  const lastAgo = formatAgo(last.mergedAt, now);
  return (
    <div data-testid="recent-merges" className="border-t border-border pt-2 text-[11px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-1">
        <span>{LAST_MERGED_LABEL}</span>
        <span className="font-mono text-foreground">{last.issueIds.join(', ')}</span>
        {lastAgo && <span>· {lastAgo}</span>}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ml-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {open ? HIDE_RECENT_LABEL : showRecentLabel(recent.length)}
        </button>
      </div>
      {open && (
        <ul className="mt-1.5 space-y-1" data-testid="recent-merges-list">
          {recent.map((merge, i) => (
            <li key={`${merge.mergedAt}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-foreground">{merge.issueIds.join(', ')}</span>
              {merge.sha && <span className="font-mono">{merge.sha}</span>}
              <span>{formatAgo(merge.mergedAt, now) ?? ''}</span>
              <span>{recentVia(merge)}</span>
              {merge.warning && <span className="w-full text-warning-foreground">{merge.warning}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
