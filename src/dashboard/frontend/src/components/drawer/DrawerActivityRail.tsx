import { useEffect, useRef } from 'react';

import { cn } from '../../lib/utils';
import { useDrawerData, type DrawerActivityItem, type DrawerActivityPhase } from './useDrawerData';

const PHASE_DOT_CLASSES = {
  work: 'bg-primary',
  review: 'bg-signal-review',
  ship: 'bg-warning',
  done: 'bg-success',
  info: 'bg-info',
} satisfies Record<DrawerActivityPhase, string>;

function formatWhen(value: string) {
  if (!value) return 'just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function DrawerActivityRailView({
  activityRail,
  compact = false,
  limit,
}: {
  activityRail: DrawerActivityItem[];
  compact?: boolean;
  limit?: number;
}) {
  const displayedActivity = limit ? activityRail.slice(0, limit) : activityRail;
  const scrollRef = useRef<HTMLDivElement>(null);
  const newestId = activityRail[0]?.id;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [newestId]);

  return (
    <aside
      data-component="drawer-activity-rail"
      data-testid="drawer-activity-rail"
      className={compact ? 'w-full bg-transparent' : 'w-[320px] shrink-0 border-l border-border bg-card/70'}
    >
      <div className="flex h-full flex-col">
        {!compact ? (
          <div className="border-b border-border px-[16px] py-[13px]">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Live Activity</div>
          </div>
        ) : null}
        <div
          ref={scrollRef}
          data-testid="drawer-activity-rail-scroll"
          className={compact ? 'max-h-52 overflow-auto pt-2' : 'min-h-0 flex-1 overflow-auto px-[16px] py-[14px]'}
        >
          {displayedActivity.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-border px-[12px] py-[18px] text-center text-[12px] text-muted-foreground">
              No activity yet.
            </div>
          ) : (
            <div className="space-y-[12px]">
              {displayedActivity.map((item) => (
                <div key={item.id} className="grid grid-cols-[14px_1fr] gap-[10px]" data-phase={item.phase}>
                  <span
                    data-testid={`drawer-activity-dot-${item.phase}`}
                    className={cn('mt-[4px] h-[8px] w-[8px] rounded-full', PHASE_DOT_CLASSES[item.phase])}
                  />
                  <div className="min-w-0">
                    <div className="text-[12px] leading-[18px] text-foreground">{item.message}</div>
                    <div className="mt-[2px] font-mono text-[10px] leading-none text-muted-foreground">{formatWhen(item.when)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

export default function DrawerActivityRail() {
  const { activityRail } = useDrawerData();
  return <DrawerActivityRailView activityRail={activityRail} />;
}
