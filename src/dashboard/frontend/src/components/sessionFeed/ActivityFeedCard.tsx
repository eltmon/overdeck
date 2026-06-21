import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { NotificationClassBadge } from '../NotificationClassBadge';
import type { ActivitySessionFeedEntry } from './types';

interface ActivityFeedCardProps {
  entry: ActivitySessionFeedEntry;
  onSelect: (entryId: string) => void;
  now?: Date;
}

export function ActivityFeedCard({ entry, onSelect, now = new Date() }: ActivityFeedCardProps) {
  const metaParts = [entry.workspaceId, entry.issueId].filter(Boolean);
  const meta = metaParts.length > 0 ? metaParts.join(' · ') : entry.summary;
  return (
    <button
      type="button"
      className="w-full rounded-lg border border-border bg-card p-2.5 text-left text-xs transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={() => onSelect(entry.id)}
      title={entry.headline}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-foreground">{entry.headline}</p>
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate">{meta}</span>
              <span aria-hidden="true" className="shrink-0">·</span>
              <time dateTime={entry.timestamp} className="shrink-0">
                {formatRelativeTime(entry.timestamp, now)}
              </time>
            </div>
            <NotificationClassBadge kind={entry.activityClass ?? 'operational'} className="shrink-0" />
          </div>
        </div>
      </div>
    </button>
  );
}
