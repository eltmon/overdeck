import type { VBriefItem } from './types';
import { VBriefItemCard } from './VBriefItemCard';

interface VBriefItemListProps {
  items: VBriefItem[];
}

export function VBriefItemList({ items }: VBriefItemListProps) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm p-4">No items in this plan.</p>;
  }

  return (
    <div className="p-4 space-y-2">
      {items.map(item => (
        <VBriefItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
