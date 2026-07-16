import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { NotificationClassBadge } from '../NotificationClassBadge';
import { ActionStatusChip } from '../ActionStatusChip';
import type { ActivitySessionFeedEntry } from './types';

interface ActivityFeedCardProps {
  entry: ActivitySessionFeedEntry;
  onSelect: (entryId: string) => void;
  now?: Date;
}

/**
 * Notifications are often long system messages (a blocked state migration, a
 * stack failure) that the operator needs to paste elsewhere, and the card
 * truncates them on screen. Copy the headline, the detail behind it when it adds
 * something, and enough provenance to place it.
 */
export function activityEntryClipboardText(entry: ActivitySessionFeedEntry): string {
  const provenance = [entry.workspaceId, entry.issueId, entry.timestamp].filter(Boolean).join(' · ');
  return [
    entry.headline,
    entry.summary && entry.summary !== entry.headline ? entry.summary : null,
    provenance || null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * An activity entry only has somewhere to go when it carries an explicit link or
 * an issue to open — navigateToFeedEntry (SessionFeedSidebar) falls through to a
 * bare return otherwise. System events have neither, so rendering them as a
 * button advertised a click that silently did nothing.
 */
function hasDestination(entry: ActivitySessionFeedEntry): boolean {
  return Boolean(entry.link || entry.issueId);
}

export function ActivityFeedCard({ entry, onSelect, now = new Date() }: ActivityFeedCardProps) {
  const metaParts = [entry.workspaceId, entry.issueId].filter(Boolean);
  const meta = metaParts.length > 0 ? metaParts.join(' · ') : entry.summary;
  const navigable = hasDestination(entry);

  const copy = () => {
    void navigator.clipboard.writeText(activityEntryClipboardText(entry)).then(
      () => toast.success('Copied'),
      () => toast.error('Copy failed'),
    );
  };

  const body = (
    <div className="flex items-start gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <div className="min-w-0 flex-1">
        <p className="break-words pr-5 font-medium text-foreground">{entry.headline}</p>
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-1">
            {entry.statusLabel ? <ActionStatusChip status={entry.statusLabel} /> : null}
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
  );

  return (
    <div className="group relative">
      {navigable ? (
        <button
          type="button"
          data-testid="activity-feed-card"
          className="w-full rounded-lg border border-border bg-card p-2.5 text-left text-xs transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={() => onSelect(entry.id)}
          title={entry.headline}
        >
          {body}
        </button>
      ) : (
        <div
          data-testid="activity-feed-card"
          className="w-full rounded-lg border border-border bg-card p-2.5 text-left text-xs"
          title={entry.headline}
        >
          {body}
        </div>
      )}
      <button
        type="button"
        data-testid="activity-feed-copy"
        onClick={copy}
        aria-label={`Copy notification: ${entry.headline}`}
        title="Copy"
        className="absolute right-1 top-1 rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-card-2 hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover:opacity-100"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
