/**
 * PAN-5244 · the strip variant of the pickup controls (presentational).
 *
 * Three switch chips (Ready, Blocks main, Park), a sliders button that opens
 * the full controls in a popover, and the Plan → Release control. It holds no
 * pickup state and fetches nothing: `PickupGateControls` owns the one copy of
 * the state and the mutations and passes its full JSX in as `children`.
 */
import { useRef, useState, type ReactNode } from 'react';
import { Play, SlidersHorizontal, TriangleAlert, Undo2 } from 'lucide-react';

import { cn } from '../../lib/utils';
import { MenuOverlay, PopoverSurface } from '../shared/ContextMenu';

type SwitchField = 'ready' | 'blocksMain' | 'parked';

export interface PickupGateStripProps {
  ready?: boolean; blocksMain?: boolean; parked?: boolean;
  planned?: boolean; released?: boolean; objection?: boolean;
  busy?: boolean;
  stage?: 'open' | 'picked-up';
  /** True when the pickup state failed to load: only the sliders button renders. */
  unavailable?: boolean;
  onToggle?: (field: SwitchField, value: boolean) => void;
  onRelease?: () => void;
  onRecall?: () => void;
  hints?: { ready: string; blocksMain: string; parked: string };
  /** The full pickup controls (or the load error), shown in the popover. */
  children: ReactNode;
}

function SwitchChip({ field, label, on, trackOn, hint, busy, onToggle }: {
  field: SwitchField;
  label: string;
  on: boolean;
  /** D-11: the checked track colour. */
  trackOn: string;
  hint?: string;
  busy?: boolean;
  onToggle?: (field: SwitchField, value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={`pickup-strip-${field}`}
      title={hint}
      disabled={busy}
      onClick={() => onToggle?.(field, !on)}
      className={cn(
        'inline-flex h-[26px] items-center gap-[6px] whitespace-nowrap rounded-[var(--radius)] border px-[8px] text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        on ? 'chip-selected text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      <span aria-hidden className={cn('relative h-[12px] w-[20px] shrink-0 rounded-full border', on ? cn(trackOn, 'border-transparent') : 'border-border bg-muted')}>
        <span className={cn('absolute top-[1px] h-[8px] w-[8px] rounded-full transition-[left] duration-150', on ? 'left-[9px] bg-background' : 'left-[1px] bg-muted-foreground')} />
      </span>
      {label}
    </button>
  );
}

const DIVIDER = <span aria-hidden className="mx-[2px] h-4 w-px bg-border" />;

export function PickupGateStrip({
  ready = false, blocksMain = false, parked = false,
  planned = false, released = false, objection = false,
  busy = false, stage = 'open', unavailable = false,
  onToggle, onRelease, onRecall, hints, children,
}: PickupGateStripProps) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);

  let planControl: ReactNode = null;
  if (stage === 'open' && !unavailable) {
    if (objection) {
      planControl = (
        <button
          type="button"
          data-testid="pickup-strip-objection"
          title="Held for review: the planning agent objects to this work. Open to decide."
          onClick={() => setOpen(true)}
          className="inline-flex h-[26px] items-center gap-[6px] rounded-[var(--radius)] border px-[8px] text-[12px] font-medium badge-bg-warning badge-border-warning text-warning-foreground"
        >
          <TriangleAlert aria-hidden className="h-3 w-3" />Objection
        </button>
      );
    } else if (planned && !released) {
      planControl = (
        <>
          {DIVIDER}
          <button
            type="button"
            data-testid="pickup-strip-release"
            title="Plan ready. Release it so an agent can pick it up."
            disabled={busy}
            onClick={onRelease}
            className="inline-flex h-[26px] items-center gap-[6px] rounded-[var(--radius)] bg-primary px-[9px] text-[12px] font-medium text-primary-foreground disabled:opacity-50"
          >
            Release<Play aria-hidden className="h-3 w-3" />
          </button>
        </>
      );
    } else if (planned && released) {
      planControl = (
        <>
          {DIVIDER}
          <span data-testid="pickup-strip-released" title="Released: eligible for pickup" className="text-[12px] text-muted-foreground">Released</span>
          <button
            type="button"
            data-testid="pickup-strip-recall"
            title="Pull it back to planned (held)"
            disabled={busy}
            onClick={onRecall}
            className="inline-flex h-[26px] items-center gap-[6px] rounded-[var(--radius)] px-[6px] text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Undo2 aria-hidden className="h-3 w-3" />Recall
          </button>
        </>
      );
    }
  }

  return (
    <div
      data-component="pickup-strip"
      data-testid="drawer-pickup-strip"
      className="relative inline-flex items-center gap-[6px]"
      onKeyDown={(event) => {
        // Escape must close the popover wherever focus sits in this control: the
        // surface only handles it when focus is inside the surface.
        if (open && event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          setOpen(false);
        }
      }}
    >
      {!unavailable && (
        <>
          <SwitchChip field="ready" label="Ready" on={ready} trackOn="switch-track-on" hint={hints?.ready} busy={busy} onToggle={onToggle} />
          <SwitchChip field="blocksMain" label="Blocks main" on={blocksMain} trackOn="bg-destructive" hint={hints?.blocksMain} busy={busy} onToggle={onToggle} />
          <SwitchChip field="parked" label="Park" on={parked} trackOn="bg-warning" hint={hints?.parked} busy={busy} onToggle={onToggle} />
        </>
      )}
      <button
        ref={moreRef}
        type="button"
        data-testid="pickup-strip-more"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Pickup controls and hints"
        title={unavailable ? 'Pickup state unavailable' : 'Pickup controls and hints'}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-[26px] w-[26px] items-center justify-center rounded-[var(--radius)] border border-border text-body-foreground transition-colors hover:bg-accent',
          open && 'bg-accent text-foreground',
        )}
      >
        <SlidersHorizontal aria-hidden className="h-[14px] w-[14px]" />
      </button>
      {planControl}
      {open && (
        <>
          <MenuOverlay onClick={() => setOpen(false)} />
          <PopoverSurface
            aria-label="Pickup controls"
            data-testid="pickup-strip-popover"
            onClose={() => setOpen(false)}
            returnFocusRef={moreRef}
            className="absolute right-0 top-full z-[1000] mt-1 w-[380px]"
          >
            <div className="p-[10px]">{children}</div>
          </PopoverSurface>
        </>
      )}
    </div>
  );
}
