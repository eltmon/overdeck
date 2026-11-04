/**
 * Open preview (PAN-4650 WI-19, FR-7, mockup flows f, g, h).
 *
 * In the title bar of a conversation a linked machine runs: **Preview** lists
 * the owner's dev-server ports (its preview-ports answer, through the link
 * proxy) plus a field for any other port. Choosing one forwards that port to
 * 127.0.0.1 here and opens it in a new tab; the popover then shows the
 * forward with **Open** and **Stop**. A port the owner refuses (one of
 * Overdeck's own) shows why.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe, Square } from 'lucide-react';

import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import type { Conversation } from '../CommandDeck/ConversationList';
import styles from '../CommandDeck/styles/command-deck.module.css';

interface PreviewPort {
  port: number;
  label: string;
}

interface Forward {
  id: string;
  port: number;
  localPort: number;
  url: string;
}

async function fetchPreviewPorts(name: string): Promise<PreviewPort[]> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(name)}/preview-ports`);
  if (!response.ok) return [];
  return ((await response.json()) as { ports?: PreviewPort[] }).ports ?? [];
}

type ForwardResult = { ok: true; forward: Forward } | { ok: false; code: string | null; error: string };

async function startForward(environmentId: string, port: number): Promise<ForwardResult> {
  const response = await fetch(`/api/machines/${encodeURIComponent(environmentId)}/forwards`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ port }),
  });
  const body = (await response.json().catch(() => null)) as (Forward & { error?: string; code?: string }) | null;
  if (response.ok && body) return { ok: true, forward: body };
  return { ok: false, code: body?.code ?? null, error: body?.error ?? `HTTP ${response.status}` };
}

async function stopForward(id: string): Promise<void> {
  await fetch(`/api/machines/forwards/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await dashboardMutationJsonHeaders() });
}

export function OpenPreviewPopover({ conversation }: { conversation: Conversation }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [forward, setForward] = useState<Forward | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = conversation.machineLabel ?? 'the other machine';
  const { data: ports = [] } = useQuery({
    queryKey: ['preview-ports', conversation.name],
    queryFn: () => fetchPreviewPorts(conversation.name),
    enabled: open,
    staleTime: 30_000,
  });

  const forwardPort = async (port: number) => {
    if (!Number.isInteger(port) || port <= 0) return setError('Type a port number.');
    setBusy(true);
    setError(null);
    try {
      const result = await startForward(conversation.environmentId ?? '', port);
      if (!result.ok) {
        return setError(result.code === 'port-refused' ? `${owner} refuses port ${port}: it is an Overdeck port` : result.error);
      }
      setForward(result.forward);
      window.open(result.forward.url, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (forward) await stopForward(forward.id);
    setForward(null);
    setOpen(false);
  };

  return (
    <span className={styles.previewAnchor}>
      <button
        type="button"
        className={`${styles.conversationAboutToggle} ${forward ? styles.conversationAboutToggleActive : ''}`}
        title={`Open preview: forward a dev-server port from ${owner}`}
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); setError(null); }}
      >
        <Globe size={14} />
        <span>{forward ? `Preview :${forward.port}` : 'Preview'}</span>
      </button>
      {open && (
        <div className={styles.previewPopover} role="dialog" aria-label="Open preview" data-testid="preview-popover">
          {forward ? (
            <>
              <p className={styles.previewTitle}>Preview from {owner}</p>
              <p className={styles.previewForwardLine} data-testid="preview-forward">
                <Globe size={12} />Forwarding {owner}:{forward.port} → 127.0.0.1:{forward.localPort}
              </p>
              <p className={styles.previewText}>Forwarded through the secure channel. It closes when you stop it, or after 30 minutes with no connection.</p>
              <div className={styles.previewActions}>
                <button type="button" className={styles.conversationAboutToggle} onClick={() => void stop()}><Square size={12} />Stop</button>
                <button type="button" className={styles.conversationAboutToggle} onClick={() => window.open(forward.url, '_blank', 'noopener')}>
                  <ExternalLink size={12} />Open
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.previewTitle}>Open preview from {owner}</p>
              <p className={styles.previewText}>Forwards a port from {owner} to 127.0.0.1 on this machine and opens it in a new tab.</p>
              {ports.map((option) => (
                <button key={option.port} type="button" className={styles.previewPortOption} disabled={busy} onClick={() => void forwardPort(option.port)}>
                  <span className={styles.machineBannerLabel}>:{option.port}</span>
                  <span>{option.label}</span>
                </button>
              ))}
              <form
                className={styles.previewActions}
                onSubmit={(event) => { event.preventDefault(); void forwardPort(Number(custom.trim())); }}
              >
                <input
                  className={styles.previewPortInput}
                  placeholder="Other port"
                  aria-label="Other port"
                  inputMode="numeric"
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                />
                <button type="submit" className={styles.conversationAboutToggle} disabled={busy || custom.trim() === ''}>
                  <Globe size={12} />Open preview
                </button>
              </form>
              {error && <p role="alert" className={styles.previewError}>{error}</p>}
            </>
          )}
        </div>
      )}
    </span>
  );
}
