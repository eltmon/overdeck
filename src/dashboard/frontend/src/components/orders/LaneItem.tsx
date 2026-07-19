import { useEffect, useState, type DragEvent } from 'react';
import type { OrderBookItem, OrderBookLane } from '@overdeck/contracts';
import { GripVertical, Settings2, Trash2 } from 'lucide-react';

export type LaneItemState = 'held' | 'released' | 'in-pipeline' | 'landed';

interface LaneItemProps {
  item: OrderBookItem;
  state: LaneItemState;
  hasPrd: boolean;
  onDragStart: (issueId: string) => void;
  onDrop: (event: DragEvent, lane: OrderBookLane, order: number) => void;
  onSwapLane: (item: OrderBookItem) => void;
  onRequirementsChange: (
    issueId: string,
    requirements: { prereqs: string[]; reVerify: boolean; planAtPickup: boolean },
  ) => Promise<void>;
  onRemove: (issueId: string) => void;
}

function rowTone(state: LaneItemState): string {
  if (state === 'in-pipeline') return 'border-l-2 border-l-info bg-info/[0.08]';
  if (state === 'landed') return 'border-l-2 border-l-success bg-success/[0.08]';
  return 'border-l-2 border-l-transparent';
}

export function LaneItem({
  item,
  state,
  hasPrd,
  onDragStart,
  onDrop,
  onSwapLane,
  onRequirementsChange,
  onRemove,
}: LaneItemProps) {
  const coloredStatus = state === 'in-pipeline' || state === 'landed';
  const [editing, setEditing] = useState(false);
  const [prereqs, setPrereqs] = useState(item.prereqs.join(', '));
  const [reVerify, setReVerify] = useState(item.reVerify);
  const [planAtPickup, setPlanAtPickup] = useState(item.planAtPickup ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setPrereqs(item.prereqs.join(', ')), [item.prereqs]);
  useEffect(() => setReVerify(item.reVerify), [item.reVerify]);
  useEffect(() => setPlanAtPickup(item.planAtPickup ?? false), [item.planAtPickup]);

  const saveRequirements = async () => {
    setSaving(true);
    try {
      await onRequirementsChange(item.issue, {
        prereqs: [...new Set(prereqs.split(/[\s,]+/).map((value) => value.trim().toUpperCase()).filter(Boolean))],
        reVerify,
        planAtPickup,
      });
      setEditing(false);
    } catch {
      // LaneEditor owns the visible mutation error; keep this editor open for correction.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      draggable={!editing}
      onDragStart={() => onDragStart(item.issue)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, item.lane, item.order)}
      data-item-state={state}
      className={`border-t border-border first:border-t-0 ${rowTone(state)}`}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.lane}{item.order} · book</span>
        <span className="w-20 shrink-0 font-mono text-[11px] text-foreground">{item.issue}</span>
        <span className="min-w-0 flex-1" aria-hidden="true" />
        {item.prereqs.length > 0 && <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">after {item.prereqs.join(', ')}</span>}
        {item.reVerify && <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${coloredStatus ? 'border-border text-muted-foreground' : 'border-warning/[0.32] bg-warning/[0.08] text-warning-foreground'}`}>re-verify</span>}
        {item.planAtPickup && <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">plan at pickup</span>}
        <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{hasPrd ? 'PRD ✓' : 'no PRD'}</span>
        <span className={`w-16 shrink-0 text-right text-[10px] ${state === 'in-pipeline' ? 'text-info' : state === 'landed' ? 'text-success' : 'text-muted-foreground'}`}>{state}</span>
        <button type="button" onClick={() => setEditing((value) => !value)} className="text-muted-foreground hover:text-foreground" aria-label={`Edit holds for ${item.issue}`}>
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => onSwapLane(item)} className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground" aria-label={`Move ${item.issue} to Lane ${item.lane === 'A' ? 'B' : 'A'}`}>
          → {item.lane === 'A' ? 'B' : 'A'}
        </button>
        <button type="button" onClick={() => onRemove(item.issue)} className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${item.issue} from book`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {editing && (
        <div className="grid gap-2 border-t border-border bg-muted/20 px-3 py-3 text-[11px] md:grid-cols-[1fr_auto_auto_auto]" aria-label={`Holds for ${item.issue}`}>
          <label className="grid gap-1 text-muted-foreground">
            Prerequisites
            <input
              aria-label={`Prerequisites for ${item.issue}`}
              value={prereqs}
              onChange={(event) => setPrereqs(event.target.value)}
              placeholder="PAN-100, PAN-101"
              className="rounded-md border border-input bg-background px-2 py-1.5 font-mono text-foreground"
            />
          </label>
          <label className="flex items-center gap-1.5 self-end pb-1.5 text-muted-foreground">
            <input type="checkbox" checked={reVerify} onChange={(event) => setReVerify(event.target.checked)} />
            Re-verify PRD
          </label>
          <label className="flex items-center gap-1.5 self-end pb-1.5 text-muted-foreground">
            <input type="checkbox" checked={planAtPickup} onChange={(event) => setPlanAtPickup(event.target.checked)} />
            Plan at pickup
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveRequirements()}
            className="self-end rounded-md border border-primary/40 px-2.5 py-1.5 text-foreground disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save holds'}
          </button>
        </div>
      )}
    </div>
  );
}
