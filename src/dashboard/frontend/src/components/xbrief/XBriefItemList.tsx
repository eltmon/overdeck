import type { XBriefItem } from './types';
import { XBriefItemCard } from './XBriefItemCard';

interface XBriefItemListProps {
  items: XBriefItem[];
}

export function XBriefItemList({ items }: XBriefItemListProps) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm p-4">No items in this plan.</p>;
  }

  return (
    <div className="p-4 space-y-2">
      {items.map(item => (
        <XBriefItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
