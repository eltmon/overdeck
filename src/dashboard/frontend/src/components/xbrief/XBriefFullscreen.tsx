import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Code2, GitBranch, List, ScrollText, X } from 'lucide-react';
import { useWorkspacePlanQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';
import { useDashboardStore } from '../../lib/store';
import { XBriefViewer, type XBriefViewTab } from './XBriefViewer';
import type { XBriefDocument, XBriefInspectionPolicy } from './types';

const VIEW_TABS: Array<{ id: XBriefViewTab; label: string; Icon: React.ElementType }> = [
  { id: 'list', label: 'List', Icon: List },
  { id: 'dag', label: 'DAG', Icon: GitBranch },
  { id: 'raw', label: 'Raw', Icon: Code2 },
];

interface PlanSummary {
  completed: number;
  total: number;
  percent: number;
  happeningNow: number;
  ready: number;
  waiting: number;
  lanes: number;
}

function summarizePlan(doc: XBriefDocument | null | undefined): PlanSummary {
  if (!doc) {
    return { completed: 0, total: 0, percent: 0, happeningNow: 0, ready: 0, waiting: 0, lanes: 0 };
  }

  const items = doc.plan.items;
  const completedIds = new Set(
    items.filter((item) => item.status === 'completed' || item.status === 'cancelled').map((item) => item.id),
  );
  const activeItems = items.filter((item) => !completedIds.has(item.id));
  const activeIds = new Set(activeItems.map((item) => item.id));
  const waitingOnEdges = new Set(
    doc.plan.edges
      .filter((edge) => edge.type === 'blocks' && activeIds.has(edge.to) && !completedIds.has(edge.from))
      .map((edge) => edge.to),
  );
  const happeningNow = activeItems.filter(
    (item) => item.status === 'running' || item.status === 'in_progress',
  ).length;
  const waiting = activeItems.filter(
    (item) => item.status === 'blocked' || waitingOnEdges.has(item.id),
  ).length;
  const ready = activeItems.length - happeningNow - waiting;
  const completed = items.filter((item) => item.status === 'completed').length;

  return {
    completed,
    total: items.length,
    percent: items.length === 0 ? 0 : Math.round((completed / items.length) * 100),
    happeningNow,
    ready: Math.max(0, ready),
    waiting,
    lanes: countExecutionLanes(doc, activeIds, completedIds),
  };
}

function countExecutionLanes(
  doc: XBriefDocument,
  activeIds: Set<string>,
  completedIds: Set<string>,
): number {
  if (activeIds.size === 0) return 0;

  const inDegree = new Map([...activeIds].map((id) => [id, 0]));
  const outgoing = new Map([...activeIds].map((id) => [id, [] as string[]]));
  for (const edge of doc.plan.edges.filter((edge) => edge.type === 'blocks')) {
    if (!activeIds.has(edge.to) || completedIds.has(edge.from)) continue;
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    if (activeIds.has(edge.from)) outgoing.get(edge.from)?.push(edge.to);
  }

  let current = [...activeIds].filter((id) => (inDegree.get(id) ?? 0) === 0);
  let lanes = 0;
  let visited = 0;
  while (current.length > 0) {
    lanes += 1;
    visited += current.length;
    const next: string[] = [];
    for (const id of current) {
      for (const child of outgoing.get(id) ?? []) {
        const degree = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, degree);
        if (degree === 0) next.push(child);
      }
    }
    current = next;
  }
  return visited === activeIds.size ? lanes : Math.max(1, lanes);
}

export function XBriefFullscreen() {
  const issueId = useDashboardStore((state) => state.xbriefViewerIssueId);
  const closeXbriefViewer = useDashboardStore((state) => state.closeXbriefViewer);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [viewTab, setViewTab] = useState<XBriefViewTab>('list');
  const queryClient = useQueryClient();
  const queryKey = ['workspace-plan', issueId];
  const { data, isLoading, isError } = useWorkspacePlanQuery(issueId ?? '', {
    enabled: issueId !== null,
  });
  const summary = useMemo(() => summarizePlan(data), [data]);
  const updateInspectionPolicy = useMutation({
    mutationFn: async (inspectionPolicy: XBriefInspectionPolicy) => {
      if (!issueId) throw new Error('No xBRIEF issue selected');
      const response = await fetch(`/api/workspaces/${issueId}/plan/inspection-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionPolicy }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return response.json() as Promise<XBriefDocument>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
    },
  });

  useEffect(() => {
    if (!issueId) return;
    dialogRef.current?.focus();
  }, [issueId]);

  useEffect(() => {
    if (!issueId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeXbriefViewer();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeXbriefViewer, issueId]);

  if (!issueId) return null;

  return (
    <div className="fixed inset-0 z-[110] flex p-3 sm:p-5">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={closeXbriefViewer}
        data-testid="xbrief-fullscreen-scrim"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="xbrief-fullscreen-title"
        tabIndex={-1}
        className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 border-b border-border px-5 py-3.5 lg:grid-cols-[minmax(320px,1fr)_auto_minmax(320px,1fr)]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded border border-border bg-muted">
              <ScrollText className="h-5 w-5 text-signal-review" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                xBRIEF · active plan
              </div>
              <h2 id="xbrief-fullscreen-title" className="truncate text-base font-medium text-foreground">
                <span className="mr-2 font-mono text-xs text-muted-foreground">{issueId}</span>
                {data?.plan.title ?? 'Plan'}
              </h2>
            </div>
          </div>

          <nav
            className="col-span-2 row-start-2 flex justify-self-center rounded border border-border bg-muted p-1 lg:col-span-1 lg:col-start-2 lg:row-start-1"
            aria-label="xBRIEF view"
            role="tablist"
          >
            {VIEW_TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={viewTab === id}
                onClick={() => setViewTab(id)}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewTab === id
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>

          <div className="col-start-2 row-start-1 flex justify-self-end lg:col-start-3">
            <button
              type="button"
              onClick={closeXbriefViewer}
              className="flex items-center gap-2 rounded border border-border px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Close full-screen xBRIEF viewer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <kbd className="font-mono text-[10px]">esc</kbd>
            </button>
          </div>
        </header>

        <section
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-2.5 text-xs"
          aria-label="Plan progress summary"
        >
          <div className="flex items-baseline gap-1.5">
            <strong className="font-medium text-foreground">{summary.completed} / {summary.total}</strong>
            <span className="text-muted-foreground">items complete</span>
          </div>
          <div
            className="h-1 min-w-24 flex-1 overflow-hidden rounded-sm bg-muted sm:max-w-72"
            role="progressbar"
            aria-label={`${summary.percent} percent complete`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.percent}
          >
            <div className="h-full bg-success" style={{ width: `${summary.percent}%` }} />
          </div>
          <div className="hidden h-5 w-px bg-border sm:block" />
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-sm bg-primary" aria-hidden="true" />
            <strong className="font-medium text-foreground">{summary.happeningNow}</strong> happening now
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-sm bg-muted-foreground" aria-hidden="true" />
            <strong className="font-medium text-foreground">{summary.ready}</strong> ready
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-sm bg-muted-foreground" aria-hidden="true" />
            <strong className="font-medium text-foreground">{summary.waiting}</strong> waiting on edges
          </div>
          <div className="hidden h-5 w-px bg-border sm:block" />
          <div className="text-muted-foreground">
            <strong className="font-medium text-foreground">{summary.lanes}</strong> execution lanes
          </div>
        </section>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isLoading && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Loading plan…
            </div>
          )}
          {isError && (
            <div className="flex flex-1 items-center justify-center text-sm text-destructive">
              Failed to load plan.
            </div>
          )}
          {!isLoading && !isError && (
            <XBriefViewer
              doc={data ?? null}
              activeTab={viewTab}
              onTabChange={setViewTab}
              showTabBar={false}
              onInspectionPolicyChange={(policy) => updateInspectionPolicy.mutate(policy)}
              isUpdatingInspectionPolicy={updateInspectionPolicy.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}
