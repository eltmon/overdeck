import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import { VBriefViewer } from '../vbrief/VBriefViewer';
import type { VBriefDocument } from '../vbrief/types';
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
  const { data, isLoading, isError } = useQuery<VBriefDocument | null>({ queryKey: ['drawer-vbrief-plan', issueId], queryFn: async () => { const res = await fetch(`/api/workspaces/${issueId}/plan`); return res.ok ? res.json() as Promise<VBriefDocument> : null; }, retry: false });
  return <div data-testid="drawer-tab-panel-plan">{isLoading ? <div className="text-[12px] text-muted-foreground">Loading plan…</div> : isError ? <div className="text-[12px] text-muted-foreground">Failed to load plan</div> : <VBriefViewer doc={data ?? null} />}</div>;
}
