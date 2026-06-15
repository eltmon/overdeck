import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { StopCircle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Global emergency-STOP hotkey. `Cmd/Ctrl + Shift + .` opens a confirm; confirming
 * POSTs /api/cloister/emergency-stop, which kills EVERY running agent via its
 * per-harness runtime (claude-code / pi / codex all implement killAgent) AND
 * freezes Deacon + flywheel auto-resume so nothing re-spawns and keeps burning
 * money. Mounted once at the app root so the key fires from anywhere.
 *
 * The kill is recoverable: agents can be resumed later, and no work is deleted.
 * A confirm step (Enter to fire, Esc to cancel) guards against an accidental
 * chord killing the whole fleet.
 */
const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
export const EMERGENCY_STOP_HOTKEY_LABEL = IS_MAC ? '⌘⇧.' : 'Ctrl+Shift+.';

/** Event name a visible button can dispatch to open the emergency-stop confirm. */
export const EMERGENCY_STOP_EVENT = 'pan:emergency-stop-open';

/** Open the emergency-stop confirm from anywhere (e.g. an app-bar button). */
export function triggerEmergencyStop(): void {
  window.dispatchEvent(new CustomEvent(EMERGENCY_STOP_EVENT));
}

async function fireEmergencyStop(): Promise<string[]> {
  const res = await fetch('/api/cloister/emergency-stop', { method: 'POST' });
  if (!res.ok) throw new Error('Emergency stop request failed');
  const data = (await res.json()) as { killedAgents?: string[] };
  return data.killedAgents ?? [];
}

export function EmergencyStopOverlay() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Arm: Cmd/Ctrl + Shift + . — works from anywhere, including inputs (it's a panic
  // key; never gate it behind "not typing").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && (e.code === 'Period' || e.key === '.' || e.key === '>')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Also open when a visible affordance (app-bar STOP button) requests it.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(EMERGENCY_STOP_EVENT, onOpen);
    return () => window.removeEventListener(EMERGENCY_STOP_EVENT, onOpen);
  }, []);

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      const killed = await fireEmergencyStop();
      toast.success(
        `Emergency STOP: killed ${killed.length} agent${killed.length === 1 ? '' : 's'}. ` +
        'Auto-resume frozen — clear the Deacon / flywheel pause when you want agents to run again.',
      );
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Emergency stop failed');
    } finally {
      setBusy(false);
    }
  }, []);

  // While the confirm is open: Enter fires, Escape cancels. Capture phase so the
  // dialog wins over any background handler.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!busy) void confirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, busy, confirm]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      role="alertdialog"
      aria-modal="true"
      aria-label="Emergency stop all agents"
      onClick={() => { if (!busy) setOpen(false); }}
    >
      <div
        className="w-[440px] max-w-[90vw] rounded-xl border badge-border-destructive bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-destructive">
          <StopCircle className="h-5 w-5" />
          <h2 className="text-sm font-semibold">Emergency STOP — kill all agents?</h2>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Immediately kills <strong>every running agent</strong> across all harnesses
          (Claude Code, Pi, Codex) and freezes Deacon + flywheel auto-resume so nothing
          re-spawns. Agents can be resumed later — this does not delete any work.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs bg-popover text-foreground hover:bg-card disabled:opacity-50"
          >
            Cancel <span className="text-muted-foreground">(Esc)</span>
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {busy ? 'Stopping…' : 'Stop all agents (Enter)'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
