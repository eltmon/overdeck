/**
 * MergePolicySection — the merge-train "Merge policy" roster (PAN-1692).
 *
 * Bulk view of every in-flight issue with a per-row auto-merge toggle and a
 * live auto/hold summary. PAN-3917: rows come from the derived issue state —
 * an issue is in flight once it is working, in review, or ready — and the
 * routing key is read by the shared AutoMergeToggle from
 * /api/merge-train/auto-merge.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { compareIssueIds } from '@overdeck/contracts';
import { isIssueInFlight } from '../../lib/pipeline-state';
import { useDashboardStore } from '../../lib/store';
import type { DerivedIssueState } from '../../types';
import { AutoMergeToggle, useAutoMergePolicyMap } from '../AutoMergeToggle';

const PHASE_LABEL: Partial<Record<DerivedIssueState['state'], string>> = {
  working: 'working',
  'in-review': 'in review',
  'changes-requested': 'changes requested',
  ready: 'ready to merge',
};

function PolicyRow({ issue, title, onNavigateIssue }: {
  issue: DerivedIssueState;
  title?: string;
  onNavigateIssue?: (issueId: string) => void;
}) {
  return (
    <li className="flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-accent/40">
      <button
        type="button"
        onClick={() => onNavigateIssue?.(issue.issueId)}
        className="w-20 shrink-0 text-left font-mono text-xs text-primary hover:underline"
      >
        {issue.issueId}
      </button>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-xs text-foreground" title={title}>
          {title ?? PHASE_LABEL[issue.state] ?? issue.state}
        </span>
        <span className="truncate text-[10px] text-muted-foreground">{PHASE_LABEL[issue.state] ?? issue.state}</span>
      </span>
      <AutoMergeToggle issueId={issue.issueId} variant="segmented" compact />
    </li>
  );
}

export function MergePolicySection({ onNavigateIssue }: { onNavigateIssue?: (issueId: string) => void }) {
  const byId = useDashboardStore((s) => s.derivedIssueStateByIssueId);
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);
  const policy = useAutoMergePolicyMap();
  const [collapsed, setCollapsed] = useState(false);

  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of (issuesRaw as Array<{ identifier?: string; title?: string }> | undefined) ?? []) {
      if (it?.identifier && it?.title) map.set(it.identifier.toUpperCase(), it.title);
    }
    return map;
  }, [issuesRaw]);

  const rows = useMemo(
    () => Object.values(byId)
      .filter(isIssueInFlight)
      .sort((a, b) => compareIssueIds(a.issueId, b.issueId)),
    [byId],
  );

  if (rows.length === 0) return null;

  const autoCount = rows.filter((issue) => policy[issue.issueId.toUpperCase()] === true).length;
  const holdCount = rows.filter((issue) => policy[issue.issueId.toUpperCase()] === false).length;

  return (
    <section className="shrink-0 border-b border-border bg-background px-4 py-3" aria-label="Merge policy">
      <button type="button" onClick={() => setCollapsed((c) => !c)} className="mb-2 flex w-full items-center justify-between text-left">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          <Zap className="h-4 w-4 text-muted-foreground" /> Merge policy
        </h2>
        <span className="text-xs text-muted-foreground">
          <b className="text-foreground">{autoCount}</b> auto · <b className="text-foreground">{holdCount}</b> hold · {rows.length} active
        </span>
      </button>
      {!collapsed && (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {rows.map((issue) => (
            <PolicyRow
              key={issue.issueId}
              issue={issue}
              {...(titleById.get(issue.issueId.toUpperCase()) ? { title: titleById.get(issue.issueId.toUpperCase())! } : {})}
              {...(onNavigateIssue ? { onNavigateIssue } : {})}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
