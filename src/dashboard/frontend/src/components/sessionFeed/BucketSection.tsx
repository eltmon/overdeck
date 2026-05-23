import { ActivityFeedCard } from './ActivityFeedCard';
import { ConversationFeedCard } from './ConversationFeedCard';
import { GitFeedCard } from './GitFeedCard';
import type { SessionFeedEntry } from './types';

interface BucketSectionProps {
  label: string;
  items: SessionFeedEntry[];
  onSelect: (entry: SessionFeedEntry) => void;
  now?: Date;
}

export function BucketSection({ label, items, onSelect, now }: BucketSectionProps) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      <div className="space-y-2">
        {items.map((entry) => renderEntry(entry, onSelect, now))}
      </div>
    </section>
  );
}

function renderEntry(entry: SessionFeedEntry, onSelect: (entry: SessionFeedEntry) => void, now?: Date) {
  const handleSelect = () => onSelect(entry);

  switch (entry.kind) {
    case 'conversation':
      return <ConversationFeedCard key={entry.id} entry={entry} onSelect={handleSelect} now={now} />;
    case 'activity':
      return <ActivityFeedCard key={entry.id} entry={entry} onSelect={handleSelect} now={now} />;
    case 'git':
      return <GitFeedCard key={entry.id} entry={entry} onSelect={handleSelect} now={now} />;
    case 'file_change':
    case 'comment':
      return null;
  }
}
