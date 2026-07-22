import type { OrderBookStatus } from '@overdeck/contracts';

const STEPS: Array<{ status: OrderBookStatus; label: string }> = [
  { status: 'draft', label: 'Draft' },
  { status: 'ready', label: 'Ready' },
  { status: 'running', label: 'Running' },
  { status: 'drained', label: 'Drained = run ends' },
  { status: 'complete', label: 'Complete' },
];

interface LifecycleStripProps {
  status: OrderBookStatus;
}

export function LifecycleStrip({ status }: LifecycleStripProps) {
  const currentIndex = STEPS.findIndex((step) => step.status === status);
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Order book lifecycle">
      {STEPS.map((step, index) => {
        const current = index === currentIndex;
        const done = index < currentIndex;
        return (
          <div key={step.status} className="flex items-center gap-1">
            <span
              aria-current={current ? 'step' : undefined}
              data-state={current ? 'current' : done ? 'done' : 'upcoming'}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-medium ${
                current
                  ? 'border-primary/50 bg-primary/10 text-foreground'
                  : done
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-border bg-card text-muted-foreground'
              }`}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px]">
                {done ? '✓' : index + 1}
              </span>
              {step.label}
            </span>
            {index < STEPS.length - 1 && <span aria-hidden="true" className="px-1 text-[10px] text-muted-foreground">→</span>}
          </div>
        );
      })}
    </nav>
  );
}
