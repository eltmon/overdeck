/**
 * PAN-2908 · C-BOARD — the backlog rollup.
 *
 * A column of hundreds of backlog cards is worthless as a view (and expensive
 * to render). The rollup groups backlog by project — count + top items by
 * priority — with per-group expand to reach every card. Backlog stays a
 * filter problem, never a wall.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { Issue } from '../../types';
import { cn } from '../../lib/utils';

const PRIORITY_TICK: Record<number, string> = {
  1: 'bg-destructive',
  2: 'bg-warning',
  3: 'bg-muted-foreground/60',
};

export function backlogGroups(issues: Issue[]): { project: string; issues: Issue[] }[] {
  const byProject = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = issue.project?.name ?? 'No project';
    const list = byProject.get(key) ?? [];
    list.push(issue);
    byProject.set(key, list);
  }
  const groups = [...byProject.entries()].map(([project, list]) => ({
    project,
    issues: [...list].sort((a, b) => (a.priority || 4) - (b.priority || 4) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
  }));
  groups.sort((a, b) => b.issues.length - a.issues.length);
  return groups;
}

export function BacklogRollup({
  issues,
  renderCard,
  onOpenIssue,
  topN = 3,
}: {
  issues: Issue[];
  renderCard: (issue: Issue) => ReactNode;
  onOpenIssue: (id: string) => void;
  topN?: number;
}) {
  const groups = useMemo(() => backlogGroups(issues), [issues]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (project: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  };

  return (
    <div className="space-y-2" data-component="backlog-rollup">
      {groups.map(({ project, issues: groupIssues }) => {
        const isOpen = expanded.has(project);
        const shown = isOpen ? groupIssues : groupIssues.slice(0, topN);
        return (
          <div key={project} className="rounded-xl border border-border bg-card p-3" data-project-group={project}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{project}</span>
              <span className="font-mono text-[11px] text-muted-foreground">· {groupIssues.length}</span>
            </div>
            <div className="space-y-1">
              {shown.map((issue) => (
                <div key={issue.id} className="relative">
                  {isOpen ? (
                    renderCard(issue)
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenIssue(issue.identifier)}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent"
                      data-rollup-row={issue.identifier}
                    >
                      <span className={cn('h-1.5 w-1.5 flex-none rounded-[3px]', PRIORITY_TICK[issue.priority] ?? 'bg-transparent')} />
                      <span className="flex-none font-mono text-[10px] text-muted-foreground">{issue.identifier}</span>
                      <span className="truncate text-xs text-muted-foreground">{issue.title}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {groupIssues.length > topN && (
              <button
                type="button"
                onClick={() => toggle(project)}
                className="mt-2 text-[11px] text-info-foreground hover:underline"
                data-rollup-toggle={project}
              >
                {isOpen ? 'Collapse' : `Show all ${groupIssues.length} →`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
