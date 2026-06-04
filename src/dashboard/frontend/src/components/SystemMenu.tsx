import { useState, useRef, useEffect } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { CloisterStatusBar } from './CloisterStatusBar';

/**
 * SystemMenu (PAN-1605) — a compact app-bar dropdown that hosts the Cloister
 * system controls (status, Start/Stop Cloister, Restart sessions, Emergency
 * stop, Settings) that used to live in the lower-left sidebar status bar.
 * Consolidates them into the top bar.
 *
 * It reuses the existing CloisterStatusBar verbatim (all its tested logic and
 * its own portaled sub-popovers for restart/emergency-confirm). Because those
 * sub-popovers portal to document.body — outside this dropdown — the dropdown
 * closes only on Escape or a re-click of the trigger, NOT on outside-click, so
 * interacting with a sub-popover never collapses the menu.
 */
export function SystemMenu({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="System controls"
        aria-expanded={open}
        title="System controls — Cloister, restart, emergency stop, settings"
        onClick={() => setOpen((o) => !o)}
        className={`rounded-md p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
          open ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 rounded-lg border border-border bg-popover p-2 shadow-lg"
        >
          <CloisterStatusBar onOpenSettings={onOpenSettings} />
        </div>
      )}
    </div>
  );
}
