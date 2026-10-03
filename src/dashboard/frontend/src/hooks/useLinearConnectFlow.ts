import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLinearMcpAuthStatus, type LinearMcpAuthStatus } from './useLinearMcpAuthStatus';
import { isLoopbackHost } from '../lib/loopbackHost';

/**
 * The "Connect Linear" flow behind the Linear MCP auth banner (PAN-4464).
 *
 * `connect()` opens a blank tab synchronously in the click handler (a
 * `window.open` after an `await` is popup-blocked), then asks the server to
 * open the usable link or have a blocked agent mint a fresh one. While a
 * flow is in progress this hook polls the status every second. On a loopback
 * dashboard host, returning to the dashboard after approving asks the link's
 * owner to re-check Linear, which closes the lifecycle; the poll then sees
 * `none` and the flow ends with a success toast.
 *
 * This hook owns the status query so the poll rate follows the phase.
 */
export type LinearConnectPhase = 'idle' | 'opening' | 'refreshing' | 'awaiting-approval' | 'checking';

export const LINEAR_CONNECT_REFRESH_TIMEOUT_MS = 90_000;
export const LINEAR_CONNECT_VERIFY_TIMEOUT_MS = 60_000;
export const LINEAR_CONNECT_FOCUS_GRACE_MS = 2_000;
export const LINEAR_CONNECT_REFRESH_TIMEOUT_COPY = 'No fresh Linear link yet — open a blocked conversation to check on it.';
export const LINEAR_CONNECT_VERIFY_TIMEOUT_COPY = "Linear still isn't connected. Finish approving in the Linear tab, then click Check now.";

export interface LinearConnectFlow {
  intervention: LinearMcpAuthStatus | undefined;
  phase: LinearConnectPhase;
  /** Set when the popup was blocked: the banner renders a plain link to it. */
  fallbackUrl: string | null;
  notice: string | null;
  connect: () => void;
  checkNow: () => void;
}

async function postJson(path: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(path, { method: 'POST' });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body['error'] === 'string' && body['error'] !== '' ? body['error'] : fallback;
}

export function useLinearConnectFlow(): LinearConnectFlow {
  const [phase, setPhase] = useState<LinearConnectPhase>('idle');
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data: intervention } = useLinearMcpAuthStatus({ fast: phase !== 'idle' });

  const tabRef = useRef<Window | null>(null);
  const previousAuthUrlRef = useRef<string | null>(null);
  const navigatedAtRef = useRef<number | null>(null);
  const autoVerifyFiredRef = useRef(false);
  const lastBlockedCountRef = useRef(0);

  const navigate = useCallback((url: string) => {
    const tab = tabRef.current;
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      setFallbackUrl(url);
    }
    navigatedAtRef.current = Date.now();
    autoVerifyFiredRef.current = false;
    setPhase('awaiting-approval');
  }, []);

  const fail = useCallback((message: string) => {
    tabRef.current?.close();
    tabRef.current = null;
    toast.error(message);
    setPhase('idle');
  }, []);

  const connect = useCallback(() => {
    if (phase !== 'idle') return;
    // Must run before any await so the browser ties it to the click.
    tabRef.current = window.open('about:blank', '_blank');
    setFallbackUrl(null);
    setNotice(null);
    setPhase('opening');
    void (async () => {
      try {
        const { ok, status, body } = await postJson('/api/linear-mcp-auth/connect');
        if (ok && status === 200 && body['action'] === 'open' && typeof body['authUrl'] === 'string') {
          navigate(body['authUrl']);
        } else if (ok && body['action'] === 'refreshing') {
          previousAuthUrlRef.current = typeof body['previousAuthUrl'] === 'string' ? body['previousAuthUrl'] : null;
          setPhase('refreshing');
        } else {
          fail(errorMessage(body, `Failed to connect Linear (${status})`));
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Failed to connect Linear');
      }
    })();
  }, [phase, navigate, fail]);

  const checkNow = useCallback(() => {
    setNotice(null);
    setPhase('checking');
    void (async () => {
      try {
        const { ok, status, body } = await postJson('/api/linear-mcp-auth/verify');
        if (!ok) {
          toast.error(errorMessage(body, `Failed to check Linear access (${status})`));
          setPhase('awaiting-approval');
        }
        // 200 alreadyConnected and 202 requested both finish via the poll.
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to check Linear access');
        setPhase('awaiting-approval');
      }
    })();
  }, []);

  // Success: the lifecycle closed while a flow was in progress. The count is
  // remembered from the last non-none payload, since `none` lists no agents.
  useEffect(() => {
    if (!intervention) return;
    if (intervention.status !== 'none') {
      lastBlockedCountRef.current = intervention.blockedAgents?.length ?? 0;
      return;
    }
    if (phase === 'idle') return;
    const count = lastBlockedCountRef.current;
    toast.success(`Linear connected — ${count} agent${count === 1 ? '' : 's'} resumed`);
    tabRef.current = null;
    setFallbackUrl(null);
    setNotice(null);
    setPhase('idle');
  }, [intervention, phase]);

  // A fresh link arrived for a refresh request. Compare against the URL the
  // server reported at refresh time: a dead owner's link can still be active.
  useEffect(() => {
    if (phase !== 'refreshing' || !intervention) return;
    if (intervention.status === 'active' && intervention.authUrl !== null
      && intervention.authUrl !== previousAuthUrlRef.current) {
      navigate(intervention.authUrl);
    }
  }, [phase, intervention, navigate]);

  useEffect(() => {
    if (phase !== 'refreshing') return;
    const timer = setTimeout(() => fail(LINEAR_CONNECT_REFRESH_TIMEOUT_COPY), LINEAR_CONNECT_REFRESH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, fail]);

  useEffect(() => {
    if (phase !== 'checking') return;
    const timer = setTimeout(() => {
      setNotice(LINEAR_CONNECT_VERIFY_TIMEOUT_COPY);
      setPhase('awaiting-approval');
    }, LINEAR_CONNECT_VERIFY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Same-machine return: the first focus or visible event after the grace
  // period asks the owner to re-check. Remote hosts finish via the paste relay.
  useEffect(() => {
    if (phase !== 'awaiting-approval' || !isLoopbackHost(window.location.hostname)) return;
    const onReturn = () => {
      if (autoVerifyFiredRef.current || document.visibilityState !== 'visible') return;
      const navigatedAt = navigatedAtRef.current;
      if (navigatedAt === null || Date.now() - navigatedAt < LINEAR_CONNECT_FOCUS_GRACE_MS) return;
      autoVerifyFiredRef.current = true;
      checkNow();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [phase, checkNow]);

  return { intervention, phase, fallbackUrl, notice, connect, checkNow };
}
