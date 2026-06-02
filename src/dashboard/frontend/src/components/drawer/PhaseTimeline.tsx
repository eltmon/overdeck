import { cn } from '../../lib/utils';
import { useIssueData, type DrawerPhaseTimelineState } from './useDrawerData';
import { useDashboardStore } from '../../lib/store';

const ACCENT_CLASSES = {
  done: 'bg-success',
  current: 'bg-signal-review',
  upcoming: 'bg-transparent',
} satisfies Record<DrawerPhaseTimelineState, string>;

/**
 * When `issueId` is provided (Command Deck issue cockpit) it reads that issue's
 * data directly; otherwise it falls back to the global drawer selection (legacy
 * IssueDrawer). One hook call either way — no global drawer side effects.
 */
export default function PhaseTimeline({ issueId }: { issueId?: string } = {}) {
  const drawerIssueId = useDashboardStore((s) => s.drawer.issueId);
  const { phaseTimeline } = useIssueData(issueId ?? drawerIssueId);

  return (
    <section data-component="drawer-phase-timeline" data-testid="drawer-phase-timeline" className="grid grid-cols-6 overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      {phaseTimeline.map((step) => (
        <div key={step.id} data-testid={`drawer-phase-${step.id}`} className="min-w-0 border-r border-border/60 last:border-r-0">
          <div data-testid={`drawer-phase-accent-${step.state}`} className={cn('h-[2px]', ACCENT_CLASSES[step.state])} />
          <div className="min-w-0 px-[7px] py-[8px]">
            <div className="truncate text-[10px] font-semibold leading-none text-foreground/80" title={step.label}>{step.label}</div>
            <div className={cn('mt-[7px] truncate font-mono text-[10px] leading-none', step.state === 'current' ? 'font-medium text-foreground' : 'text-muted-foreground')}>{step.when}</div>
            <div className="mt-[6px] truncate text-[9px] leading-none text-muted-foreground">{step.sub}</div>
          </div>
        </div>
      ))}
    </section>
  );
}
