/**
 * RetrospectiveButton — Command Deck header button that starts a No-project
 * pipeline retrospective conversation (PAN-3841).
 *
 * Opens a small menu with the two supported windows (24h / 7d) and POSTs the
 * choice to /api/conversations/retrospective, which renders
 * roles/retrospective.md server-side and creates the conversation. On
 * success we navigate to it; on failure we toast and re-enable the button.
 */

import { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { toast } from 'sonner';
import type { Harness } from '../chat/ModelPicker';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import styles from './styles/command-deck.module.css';

interface RetrospectiveButtonProps {
  model: string;
  harness?: Harness;
  disabled?: boolean;
}

const WINDOWS = [
  { window: '24h', label: 'Last 24 hours' },
  { window: '7d', label: 'Last 7 days' },
] as const;

export function RetrospectiveButton({ model, harness, disabled }: RetrospectiveButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  const startRetrospective = async (window_: string) => {
    setOpen(false);
    setPending(true);
    try {
      const res = await fetch('/api/conversations/retrospective', {
        method: 'POST',
        // dashboardMutationJsonHeaders resolves a WebSocket RPC URL before
        // hitting the CSRF/session bootstrap; a relative REST path has no
        // base for `new URL(...)`. The helper is safe to call with no arg
        // — it reuses the connection already memoized at app boot.
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ window: window_, model, harness }),
      });
      if (res.ok) {
        const conv = (await res.json()) as { name: string };
        window.location.assign('/conv/' + encodeURIComponent(conv.name));
        return;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(err.error ?? `Failed to start the retrospective (${res.status})`);
    } catch {
      toast.error('Failed to start the retrospective (network error)');
    }
    setPending(false);
  };

  return (
    <div className={styles.retroMenuHost} ref={hostRef}>
      <button
        type="button"
        className={styles.conversationAddBtn}
        title="Pipeline retrospective"
        aria-label="Pipeline retrospective"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || !model || pending}
        onClick={() => setOpen((v) => !v)}
      >
        <History size={13} />
      </button>
      {open && (
        <div role="menu" className={styles.retroMenu}>
          {WINDOWS.map(({ window: window_, label }) => (
            <button
              key={window_}
              type="button"
              role="menuitem"
              className={styles.retroMenuItem}
              onClick={() => void startRetrospective(window_)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
