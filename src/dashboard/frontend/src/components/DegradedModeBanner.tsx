import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

import { useConnectionPhase, useConnectionState, type ConnectionPhase } from '../lib/connectionState';

/** How long the "Reconnected" confirmation stays up. */
export const RECONNECTED_CONFIRMATION_MS = 2_500;
/**
 * Before the tab's first live bootstrap the phase reads `delayed` for the few
 * milliseconds a healthy bootstrap takes; wait this long before reporting it
 * so a normal page load does not flash the banner.
 */
export const FIRST_LOAD_DELAYED_GRACE_MS = 3_000;

type Degraded = Exclude<ConnectionPhase, 'live'>;
type Shown = Degraded | 'reconnected' | null;

interface DashboardLifecycleView {
  issueId?: string | null;
  reason?: string | null;
}

interface DegradedModeBannerProps {
  lifecycle: DashboardLifecycleView;
  onRestartBackend: () => void;
  isRestartBackendPending: boolean;
}

/** `HH:MM` for the freshness stamp. */
export function formatDataTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * DegradedModeBanner (PAN-4279) — the only outage indicator in the app shell.
 * The last-known UI stays mounted and usable underneath; this row says what is
 * wrong, how old the data is, and offers Retry (and Force Restart when the
 * server does not answer). Phase comes from the connection store.
 */
export function DegradedModeBanner({ lifecycle, onRestartBackend, isRestartBackendPending }: DegradedModeBannerProps) {
  const phase = useConnectionPhase();
  const lastLiveAt = useConnectionState((s) => s.lastLiveAt);
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<Shown>(null);
  const everLive = useRef(false);

  useEffect(() => {
    if (phase === 'live') {
      everLive.current = true;
      // Confirm recovery only when a degraded state was actually on screen.
      setShown((prev) => (prev === null ? null : 'reconnected'));
      return;
    }
    if (phase === 'delayed' && !everLive.current) {
      // Already reporting an outage: switch at once. Otherwise wait out the grace.
      setShown((prev) => (prev === null ? null : 'delayed'));
      const timer = setTimeout(() => setShown('delayed'), FIRST_LOAD_DELAYED_GRACE_MS);
      return () => clearTimeout(timer);
    }
    setShown(phase);
  }, [phase]);

  useEffect(() => {
    if (shown !== 'reconnected') return;
    const timer = setTimeout(() => setShown(null), RECONNECTED_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  if (shown === null) return null;

  const retry = () => {
    useConnectionState.getState().requestReconnect();
    void queryClient.refetchQueries({ queryKey: ['backend-health'] });
  };
  const since = lastLiveAt === null ? '' : formatDataTime(lastLiveAt);
  const destructive = shown === 'unreachable';
  const buttonClass = `shrink-0 rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    destructive ? 'border-destructive/40 hover:bg-destructive/15' : 'border-warning/40 hover:bg-warning/20'
  }`;
  const retryButton = (
    <button type="button" onClick={retry} className={buttonClass}>
      Retry
    </button>
  );

  let tone = 'bg-warning/10 text-warning-foreground';
  let icon = <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />;
  let message: React.ReactNode;
  let actions: React.ReactNode = null;
  switch (shown) {
    case 'unreachable':
      tone = 'bg-destructive/10 text-destructive';
      icon = <AlertTriangle className="h-3.5 w-3.5 shrink-0" />;
      message = <>Can&apos;t reach the Overdeck server{since && ` — showing data from ${since}`}</>;
      actions = (
        <>
          {retryButton}
          <button
            type="button"
            onClick={onRestartBackend}
            disabled={isRestartBackendPending}
            className={buttonClass}
          >
            {isRestartBackendPending ? 'Restarting…' : 'Force Restart'}
          </button>
        </>
      );
      break;
    case 'restarting':
      message = (
        <>
          Overdeck server is restarting{since && ` — showing data from ${since}`}
          {lifecycle.issueId && (
            <> — <span className="font-mono">{lifecycle.issueId}</span></>
          )}
          {lifecycle.reason && <span className="ml-1 opacity-70">({lifecycle.reason})</span>}
        </>
      );
      break;
    case 'delayed':
      message = <>Live updates are delayed — reconnecting{since && ` · showing data from ${since}`}</>;
      actions = retryButton;
      break;
    case 'reconnected':
      tone = 'bg-muted/40 text-muted-foreground';
      icon = <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />;
      message = 'Reconnected';
      break;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-component="degraded-mode-banner"
      data-phase={shown === 'reconnected' ? 'live' : shown}
      className={`flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-xs ${tone}`}
    >
      {icon}
      <p className="flex-1 truncate">{message}</p>
      {actions}
    </div>
  );
}
