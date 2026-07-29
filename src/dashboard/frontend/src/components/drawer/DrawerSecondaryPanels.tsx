import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import { XBriefViewer } from '../xbrief/XBriefViewer';
import type { XBriefDocument } from '../xbrief/types';
import { IssueViewFullscreenButton } from '../issue-view/IssueView';
import { useDashboardStore } from '../../lib/store';
import { useDrawerData, type DrawerActivityPhase } from './useDrawerData';

const DOT_CLASSES = { work: 'bg-primary', review: 'bg-signal-review', ship: 'bg-warning', done: 'bg-success', info: 'bg-info' } satisfies Record<DrawerActivityPhase, string>;

export function DrawerActivityPanel() {
  const { activityFull } = useDrawerData();
  return <div data-testid="drawer-tab-panel-activity">{activityFull.length === 0 ? <div className="rounded-[12px] border border-dashed border-border px-[12px] py-[18px] text-center text-[12px] text-muted-foreground">No activity yet.</div> : <div className="space-y-[12px]">{activityFull.map((item) => {
    const date = new Date(item.when);
    const when = !item.when ? 'just now' : Number.isNaN(date.getTime()) ? item.when : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return <div key={item.id} className="grid grid-cols-[14px_1fr] gap-[10px]" data-phase={item.phase}><span aria-hidden="true" className={cn('mt-[4px] h-[8px] w-[8px] rounded-full', DOT_CLASSES[item.phase])} /><div className="min-w-0"><div className="text-[12px] leading-[18px] text-foreground">{item.message}</div><div className="mt-[2px] font-mono text-[10px] leading-none text-muted-foreground">{when}</div></div></div>;
  })}</div>}</div>;
}

export function DrawerPlanPanel({ issueId }: { issueId: string }) {
  const openXbriefViewer = useDashboardStore((state) => state.openXbriefViewer);
  const { data, isLoading, isError } = useQuery<XBriefDocument | null>({ queryKey: ['drawer-xbrief-plan', issueId], queryFn: async () => { const res = await fetch(`/api/workspaces/${issueId}/plan`); return res.ok ? res.json() as Promise<XBriefDocument> : null; }, retry: false });
  // C-DETAIL: the DAG is the body of Plan map — it leads; List/Raw stay one
  // sub-tab away (initialTab only seeds the first mount per view).
  return <div data-testid="drawer-tab-panel-plan" className="relative"><IssueViewFullscreenButton ariaLabel="Expand xBRIEF full screen" onClick={() => openXbriefViewer(issueId)} className="absolute right-2 top-2 z-10 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground" />{isLoading ? <div className="text-[12px] text-muted-foreground">Loading plan…</div> : isError ? <div className="text-[12px] text-muted-foreground">Failed to load plan</div> : <XBriefViewer doc={data ?? null} initialTab="dag" />}</div>;
}
