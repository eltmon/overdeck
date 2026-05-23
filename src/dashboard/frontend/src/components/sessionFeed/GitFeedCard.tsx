import { GitBranch, GitCommit } from 'lucide-react';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import type { GitSessionFeedEntry } from './types';

interface GitFeedCardProps {
  entry: GitSessionFeedEntry;
  onSelect: (entryId: string) => void;
  now?: Date;
}

export function GitFeedCard({ entry, onSelect, now = new Date() }: GitFeedCardProps) {
  const Icon = selectGitIcon(entry.source);

  return (
    <button
      type="button"
      className="w-full rounded-lg border border-border bg-card p-2.5 text-left text-xs transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={() => onSelect(entry.id)}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon data-testid="git-feed-icon" className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{entry.message}</span>
        {entry.issueId && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {entry.issueId}
          </span>
        )}
        <time dateTime={entry.timestamp} className="shrink-0 text-[10px] text-muted-foreground">
          {formatRelativeTime(entry.timestamp, now)}
        </time>
      </div>
    </button>
  );
}

function selectGitIcon(source: string) {
  return source.toLowerCase().includes('branch') ? GitBranch : GitCommit;
}
