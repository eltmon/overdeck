import { cn } from '../../lib/utils';
import { useDrawerData, type DrawerReviewSpecialistStatus } from './useDrawerData';

const STATUS_DOT_CLASSES = {
  run: 'bg-info',
  idle: 'bg-muted-foreground',
  done: 'bg-success',
  fail: 'bg-destructive',
} satisfies Record<DrawerReviewSpecialistStatus, string>;

export default function DrawerReviewSpecialists() {
  const { reviewSpecialists } = useDrawerData();

  return (
    <section data-component="drawer-review-specialists" data-testid="drawer-review-specialists" className="rounded-[var(--radius)] border border-border bg-card p-[14px]">
      <div className="mb-[10px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Review Specialists</div>
      <div className="space-y-[8px]">
        {reviewSpecialists.map((specialist) => (
          <div key={specialist.id} className="grid grid-cols-[14px_1fr_auto_auto] items-center gap-[10px] rounded-[10px] bg-background/45 px-[10px] py-[8px]">
            <span
              data-testid={`drawer-review-specialist-dot-${specialist.status}`}
              className={cn('h-[8px] w-[8px] rounded-full', STATUS_DOT_CLASSES[specialist.status])}
            />
            <span className="min-w-0 truncate font-mono text-[11px] text-foreground">{specialist.name}</span>
            <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{specialist.meta}</span>
            <span className="max-w-[120px] truncate font-mono text-[10px] text-muted-foreground" title={specialist.duration}>{specialist.duration}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
