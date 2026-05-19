import { cn } from '../../lib/utils';
import { useDrawerData, type DrawerPhaseTimelineState } from './useDrawerData';

const ACCENT_CLASSES = {
  done: 'bg-success',
  current: 'bg-signal-review',
  upcoming: 'bg-transparent',
} satisfies Record<DrawerPhaseTimelineState, string>;

export default function PhaseTimeline() {
  const { phaseTimeline } = useDrawerData();

  return (
    <section data-component="drawer-phase-timeline" data-testid="drawer-phase-timeline" className="grid grid-cols-6 overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      {phaseTimeline.map((step) => (
        <div key={step.id} data-testid={`drawer-phase-${step.id}`} className="border-r border-border/60 last:border-r-0">
          <div data-testid={`drawer-phase-accent-${step.state}`} className={cn('h-[2px]', ACCENT_CLASSES[step.state])} />
          <div className="px-[10px] py-[9px]">
            <div className="text-[10px] font-medium uppercase leading-none tracking-[0.08em] text-muted-foreground">{step.label}</div>
            <div className={cn('mt-[7px] font-mono text-[11px] leading-none', step.state === 'current' ? 'font-medium text-foreground' : 'text-muted-foreground')}>{step.when}</div>
            <div className="mt-[6px] text-[10px] leading-none text-muted-foreground">{step.sub}</div>
          </div>
        </div>
      ))}
    </section>
  );
}
