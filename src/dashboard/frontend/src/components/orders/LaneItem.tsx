import type { DragEvent } from 'react';
import type { OrderBookItem, OrderBookLane } from '@overdeck/contracts';
import { GripVertical, Trash2 } from 'lucide-react';

export type LaneItemState = 'held' | 'released' | 'in-pipeline' | 'landed';

interface LaneItemProps {
  item: OrderBookItem;
  state: LaneItemState;
  hasPrd: boolean;
  onDragStart: (issueId: string) => void;
  onDrop: (event: DragEvent, lane: OrderBookLane, order: number) => void;
  onSwapLane: (item: OrderBookItem) => void;
  onRemove: (issueId: string) => void;
}

function rowTone(state: LaneItemState): string {
  if (state === 'in-pipeline') return 'border-l-2 border-l-info bg-info/[0.08]';
  if (state === 'landed') return 'border-l-2 border-l-success bg-success/[0.08]';
  return 'border-l-2 border-l-transparent';
}

export function LaneItem({ item, state, hasPrd, onDragStart, onDrop, onSwapLane, onRemove }: LaneItemProps) {
  const coloredStatus = state === 'in-pipeline' || state === 'landed';
  return (
    <div
      draggable
      onDragStart={() => onDragStart(item.issue)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, item.lane, item.order)}
      data-item-state={state}
      className={`flex items-center gap-2 border-t border-border px-3 py-2 text-xs first:border-t-0 ${rowTone(state)}`}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.lane}{item.order} · book</span>
      <span className="w-20 shrink-0 font-mono text-[11px] text-foreground">{item.issue}</span>
      <span className="min-w-0 flex-1" aria-hidden="true" />
      {item.prereqs.length > 0 && <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">after {item.prereqs.join(', ')}</span>}
      {item.reVerify && <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${coloredStatus ? 'border-border text-muted-foreground' : 'border-warning/[0.32] bg-warning/[0.08] text-warning-foreground'}`}>re-verify</span>}
      <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{hasPrd ? 'PRD ✓' : 'no PRD'}</span>
      <span className={`w-16 shrink-0 text-right text-[10px] ${state === 'in-pipeline' ? 'text-info' : state === 'landed' ? 'text-success' : 'text-muted-foreground'}`}>{state}</span>
      <button type="button" onClick={() => onSwapLane(item)} className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground" aria-label={`Move ${item.issue} to Lane ${item.lane === 'A' ? 'B' : 'A'}`}>
        → {item.lane === 'A' ? 'B' : 'A'}
      </button>
      <button type="button" onClick={() => onRemove(item.issue)} className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${item.issue} from book`}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
