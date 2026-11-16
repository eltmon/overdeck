/**
 * "Shut down Overdeck…" confirmation (PAN-5342 WI-10, FR-8, FR-9).
 *
 * Opened by a window event from the agents menu, the health popover's System
 * controls (`ShutdownSystemControl`) and the command palette, the way
 * EmergencyStopOverlay is opened. It has no hotkey (FR-8) and no form submit,
 * so Enter can never start a shutdown by accident.
 *
 * On open it reads `GET /api/shutdown/preview` to say what will stop. Confirm
 * posts `POST /api/shutdown { reboot }`; the drain itself, its banner and its
 * deadline (120 s, the route's default) belong to the server (D-5, D-8). While
 * a `pan reload`/`pan restart` holds the restart lock the route answers 409
 * (D-11), so the dialog disables Shut down up front.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Power } from 'lucide-react';
import { toast } from 'sonner';
import type { ShutdownWriter } from '@overdeck/contracts';

import { Modal } from './shared/Modal';

/** Event name any entry point dispatches to open the shutdown confirmation. */
export const SHUTDOWN_OPEN_EVENT = 'pan:shutdown-open';

/** Open the shutdown confirmation from anywhere. */
export function triggerShutdownDialog(): void {
  window.dispatchEvent(new CustomEvent(SHUTDOWN_OPEN_EVENT));
}

export interface ShutdownPreview {
  agents: number;
  conversations: number;
  workingNow: number;
  writers: readonly ShutdownWriter[];
  restartInProgress: { pid: number } | null;
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: ShutdownPreview }
  | { status: 'failed' };

const BUTTON =
  'inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60';
const DESTRUCTIVE =
  'inline-flex h-9 items-center rounded-lg border border-destructive bg-destructive px-3 text-[13px] text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-60';

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

async function fetchShutdownPreview(): Promise<ShutdownPreview> {
  const res = await fetch('/api/shutdown/preview');
  if (!res.ok) throw new Error(`GET /api/shutdown/preview failed: ${res.status}`);
  return (await res.json()) as ShutdownPreview;
}

/** POST /api/shutdown; resolves with the route's error text, or null on success. */
async function postShutdown(reboot: boolean): Promise<string | null> {
  try {
    const res = await fetch('/api/shutdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reboot }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? `Shutdown request failed (HTTP ${res.status})`;
  } catch {
    return 'Could not reach the dashboard';
  }
}

export function ShutdownDialog() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [reboot, setReboot] = useState(false);
  const [busy, setBusy] = useState(false);
  // Each open gets a token; a preview that resolves after a close or a reopen is dropped.
  const requestRef = useRef(0);

  useEffect(() => {
    const onOpen = () => {
      const request = ++requestRef.current;
      setReboot(false);
      setBusy(false);
      setPreview({ status: 'loading' });
      setOpen(true);
      fetchShutdownPreview().then(
        (result) => { if (requestRef.current === request) setPreview({ status: 'ready', preview: result }); },
        () => { if (requestRef.current === request) setPreview({ status: 'failed' }); },
      );
    };
    window.addEventListener(SHUTDOWN_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SHUTDOWN_OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    requestRef.current += 1;
    setOpen(false);
  }, []);

  const confirm = useCallback(async () => {
    setBusy(true);
    const error = await postShutdown(reboot);
    if (error) toast.error(error);
    setBusy(false);
    close();
  }, [reboot, close]);

  if (!open) return null;

  const ready = preview.status === 'ready' ? preview.preview : null;
  const restartBlocked = ready?.restartInProgress != null;

  return (
    <Modal
      title="Shut down Overdeck?"
      onClose={close}
      dismissible={!busy}
      footer={
        <>
          <button type="button" className={BUTTON} onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={DESTRUCTIVE}
            onClick={() => void confirm()}
            disabled={busy || restartBlocked}
            data-testid="shutdown-confirm"
          >
            {busy ? 'Shutting down…' : 'Shut down'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed" data-testid="shutdown-dialog">
        {ready ? (
          <p data-testid="shutdown-preview">
            Each agent finishes the tool call it is running. Then Overdeck stops {plural(ready.agents, 'agent')} and{' '}
            {plural(ready.conversations, 'conversation')} ({ready.workingNow} working now), the dashboard and its
            services. Nothing is killed unless you force it. Deadline: 2 minutes.
          </p>
        ) : (
          <p>
            Each agent finishes the tool call it is running. Then Overdeck stops every agent and conversation, the
            dashboard and its services. Nothing is killed unless you force it. Deadline: 2 minutes.
          </p>
        )}
        {preview.status === 'loading' && <p className="text-muted-foreground">Counting what is running…</p>}
        {preview.status === 'failed' && (
          <p className="text-muted-foreground">Could not read what is running. Shutting down still drains every session.</p>
        )}
        {ready && ready.writers.length > 0 && (
          <div>
            <p className="text-muted-foreground">Overdeck waits for this server work to finish first:</p>
            <ul className="mt-1 list-disc pl-5" data-testid="shutdown-writers">
              {ready.writers.map((writer) => (
                <li key={`${writer.kind}:${writer.label}`}>{writer.label}</li>
              ))}
            </ul>
          </div>
        )}
        {restartBlocked && (
          <p role="alert" className="text-warning-foreground">
            A pan reload or restart is in progress. Wait for it to finish.
          </p>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={reboot} disabled={busy} onChange={(e) => setReboot(e.target.checked)} />
          Reboot when done
        </label>
      </div>
    </Modal>
  );
}

/** The health popover's System controls entry (PAN-5342 FR-8). */
export function ShutdownSystemControl() {
  return (
    <button
      type="button"
      onClick={triggerShutdownDialog}
      className="mt-2 inline-flex items-center gap-1.5 rounded border border-border bg-popover px-2 py-1 text-xs text-foreground transition-colors hover:bg-card"
    >
      <Power className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      Shut down Overdeck…
    </button>
  );
}
