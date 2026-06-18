/**
 * MergePolicySection — flywheel "Merge policy" roster (PAN-1692 placement B).
 *
 * Bulk view of every in-flight pipeline issue with a per-row auto-merge toggle
 * and a live auto/hold summary. Self-contained: reads the review-status
 * snapshots straight from the store and reuses the shared AutoMergeToggle.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import type { ReviewStatusSnapshot } from '@overdeck/contracts';
import { useDashboardStore } from '../lib/store';
import { AutoMergeToggle } from './AutoMergeToggle';

function shortPhase(rs: ReviewStatusSnapshot): string {
  if (rs.mergeStatus === 'merging' || rs.mergeStatus === 'queued' || rs.mergeStatus === 'verifying') return 'merging';
  if (rs.readyForMerge) return 'ready to merge';
  if (rs.reviewStatus === 'reviewing') return 'in review';
  if (rs.testStatus === 'testing') return 'testing';
  if (rs.reviewStatus === 'failed' || rs.testStatus === 'failed') return 'failed';
  if (rs.reviewStatus === 'passed') return 'review passed';
  return 'in progress';
}

/** An issue counts as "in flight" once it has entered review/test/merge or is ready. */
function isActive(rs: ReviewStatusSnapshot): boolean {
  return (
    rs.mergeStatus !== 'merged' &&
    (rs.readyForMerge === true ||
      !!rs.mergeStatus ||
      (rs.reviewStatus !== undefined && rs.reviewStatus !== 'pending') ||
      (rs.testStatus !== undefined && rs.testStatus !== 'pending'))
  );
}

export function MergePolicySection({ onNavigateIssue }: { onNavigateIssue?: (issueId: string) => void }) {
  const byId = useDashboardStore((s) => s.reviewStatusByIssueId);
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);
  // Map issue identifier (case-insensitive) → human title, sourced from the raw
  // issue list. ReviewStatusSnapshot carries no title, so the roster looked it
  // up nowhere and showed only the phase.
  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of (issuesRaw as Array<{ identifier?: string; title?: string }> | undefined) ?? []) {
      if (it?.identifier && it?.title) map.set(it.identifier.toUpperCase(), it.title);
    }
    return map;
  }, [issuesRaw]);
  const [collapsed, setCollapsed] = useState(false);
  const rows = Object.values(byId)
    .filter(isActive)
    .sort((a, b) => a.issueId.localeCompare(b.issueId));

  if (rows.length === 0) return null;

  const autoCount = rows.filter((r) => r.autoMerge === true).length;
  const holdCount = rows.filter((r) => r.autoMerge === false).length;

  return (
    <section className="shrink-0 border-b border-border bg-background px-4 py-3" aria-label="Merge policy">
      <button type="button" onClick={() => setCollapsed((c) => !c)} className="mb-2 flex w-full items-center justify-between text-left">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          <Zap className="h-4 w-4 text-emerald-400" /> Merge policy
        </h2>
        <span className="text-xs text-muted-foreground">
          <b className="text-emerald-400">{autoCount}</b> auto · <b className="text-amber-400">{holdCount}</b> hold · {rows.length} active
        </span>
      </button>
      {!collapsed && (
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {rows.map((rs) => (
          <li key={rs.issueId} className="flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-accent/40">
            <button
              type="button"
              onClick={() => onNavigateIssue?.(rs.issueId)}
              className="w-20 shrink-0 text-left font-mono text-xs text-primary hover:underline"
            >
              {rs.issueId}
            </button>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-xs text-foreground" title={titleById.get(rs.issueId.toUpperCase())}>
                {titleById.get(rs.issueId.toUpperCase()) ?? shortPhase(rs)}
              </span>
              <span className="truncate text-[10px] text-muted-foreground">{shortPhase(rs)}</span>
            </span>
            <AutoMergeToggle issueId={rs.issueId} autoMerge={rs.autoMerge} variant="segmented" compact />
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
