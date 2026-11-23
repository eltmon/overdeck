/**
 * One issue in an order-book lane (PAN-5597 WI-6): position, id, the full
 * title, one status tag, and only the notes that apply. Row actions show on
 * hover and on keyboard focus.
 */
import { useState, type DragEvent } from 'react';
import type { OrderBookItem } from '@overdeck/contracts';
import { GripVertical } from 'lucide-react';

import { trackerIssueUrl } from '../../lib/issueLinks';
import type { ItemStatus, ItemStatusTone } from './itemStatus';

export const STATUS_TAG_CLASSES: Record<ItemStatusTone, string> = {
  success: 'border-success/[0.32] bg-success/[0.08] text-success-foreground',
  warning: 'border-warning/[0.32] bg-warning/[0.08] text-warning-foreground',
  info: 'border-info/[0.32] bg-info/[0.08] text-info-foreground',
  neutral: 'border-border text-muted-foreground',
};

const LEFT_BORDER: Partial<Record<ItemStatus['kind'], string>> = {
  working: 'border-l-info',
  review: 'border-l-warning',
  landed: 'border-l-success',
};

export interface IssueRequirements {
  prereqs: string[];
  reVerify: boolean;
  planAtPickup: boolean;
}

interface IssueRowProps {
  item: OrderBookItem;
  title?: string;
  status: ItemStatus;
  /** Muted notes under the title, already filtered to what applies. */
  notes: string[];
  readOnly?: boolean;
  onDragStart?: (issueId: string) => void;
  onDrop?: (event: DragEvent, lane: OrderBookItem['lane'], order: number) => void;
  onSwapLane?: (item: OrderBookItem) => void;
  onRemove?: (issueId: string) => void;
  onSaveOptions?: (issueId: string, requirements: IssueRequirements) => Promise<void>;
}

function parseIds(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((entry) => entry.trim().toUpperCase()).filter(Boolean))];
}

export function IssueRow({
  item,
  title,
  status,
  notes,
  readOnly = false,
  onDragStart,
  onDrop,
  onSwapLane,
  onRemove,
  onSaveOptions,
}: IssueRowProps) {
  const [editing, setEditing] = useState(false);
  const [prereqs, setPrereqs] = useState('');
  const [reVerify, setReVerify] = useState(false);
  const [planAtPickup, setPlanAtPickup] = useState(false);
  const [saving, setSaving] = useState(false);
  const landed = status.kind === 'landed';
  const url = trackerIssueUrl(item.issue);

  const openOptions = () => {
    setPrereqs(item.prereqs.join(', '));
    setReVerify(item.reVerify);
    setPlanAtPickup(item.planAtPickup ?? false);
    setEditing(true);
  };

  const save = async () => {
    if (!onSaveOptions) return;
    setSaving(true);
    try {
      await onSaveOptions(item.issue, { prereqs: parseIds(prereqs), reVerify, planAtPickup });
      setEditing(false);
    } catch {
      // The list reports the error; keep the block open so the operator can correct it.
    }
    setSaving(false);
  };

  const draggable = !readOnly && !editing;
  return (
    <div
      data-issue={item.issue}
      data-status={status.kind}
      draggable={draggable}
      onDragStart={draggable ? () => onDragStart?.(item.issue) : undefined}
      onDragOver={readOnly ? undefined : (event) => event.preventDefault()}
      onDrop={readOnly ? undefined : (event) => onDrop?.(event, item.lane, item.order)}
      className={`list-row group border-l-2 border-t border-t-border first:border-t-0 ${LEFT_BORDER[status.kind] ?? 'border-l-transparent'}`}
    >
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-xs">
        {!readOnly && <GripVertical className="hidden h-3.5 w-3.5 shrink-0 cursor-grab text-faint-foreground sm:block" aria-hidden="true" />}
        <span className="hidden w-7 shrink-0 font-mono text-[11px] text-faint-foreground sm:inline">{item.lane}{item.order}</span>
        {url
          ? <a href={url} target="_blank" rel="noreferrer" className="w-[4.75rem] shrink-0 font-mono text-[11px] text-foreground hover:text-primary hover:underline">{item.issue}</a>
          : <span className="w-[4.75rem] shrink-0 font-mono text-[11px] text-foreground">{item.issue}</span>}
        <div className="min-w-0 flex-1">
          <div className={`truncate ${landed ? 'text-muted-foreground' : 'text-foreground'}`} title={title ?? item.issue}>{title ?? item.issue}</div>
          {!landed && notes.length > 0 && <div className="truncate text-[11px] text-muted-foreground">{notes.join(' · ')}</div>}
        </div>
        {!readOnly && !landed && (
          // Zero width until hover or keyboard focus, so the hidden actions take no room from
          // the title and never cover the status tag; the buttons stay in the tab order.
          <div className="flex max-w-0 shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap opacity-0 transition-opacity group-hover:max-w-none group-hover:opacity-100 group-focus-within:max-w-none group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onSwapLane?.(item)}
              className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              aria-label={`${item.lane === 'A' ? 'Run one at a time' : 'Run in parallel'}: ${item.issue}`}
            >
              {item.lane === 'A' ? 'Run one at a time' : 'Run in parallel'}
            </button>
            <button
              type="button"
              onClick={() => (editing ? setEditing(false) : openOptions())}
              aria-expanded={editing}
              className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              aria-label={`Options: ${item.issue}`}
            >
              Options
            </button>
            <button
              type="button"
              onClick={() => onRemove?.(item.issue)}
              className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
              aria-label={`Remove: ${item.issue}`}
            >
              Remove
            </button>
          </div>
        )}
        <span title={status.label} className={`max-w-[45%] shrink-0 truncate whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] sm:max-w-none ${STATUS_TAG_CLASSES[status.tone]}`}>{status.label}</span>
      </div>
      {editing && (
        <div className="list-meta grid gap-2.5 border-t border-border px-3 py-3 text-[11px]" aria-label={`Options for ${item.issue}`}>
          <label className="grid max-w-md gap-1 text-muted-foreground">
            Start only after these issues land
            <input
              value={prereqs}
              onChange={(event) => setPrereqs(event.target.value)}
              placeholder="PAN-100, PAN-101"
              className="rounded-md border border-input bg-background px-2 py-1.5 font-mono text-foreground"
            />
            <span className="text-faint-foreground">Pick from this book or type any issue ID.</span>
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" checked={reVerify} onChange={(event) => setReVerify(event.target.checked)} />
            Re-check the PRD against main before starting
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" checked={planAtPickup} onChange={(event) => setPlanAtPickup(event.target.checked)} />
            Write the plan when it starts
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-md border border-primary bg-primary px-2.5 py-1 text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
