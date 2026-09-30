import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  deriveConnectionPhase,
  isWriteBlockedPhase,
  showFirstLoadScreen,
  useConnectionState,
  type ConnectionInputs,
  type ConnectionPhase,
} from '../lib/connectionState';

/**
 * Degraded mode (PAN-4279) never hides mounted content: the route views stay
 * visible and navigable on the last-known data while `DegradedModeBanner`
 * reports the outage. The only full-page outage state is the first-load
 * screen, shown when the tab has nothing cached to render.
 */
export function BackendConnectionBoundary({ children }: { children: ReactNode }) {
  const inputs = useConnectionState(
    useShallow((s): ConnectionInputs => ({
      serverReachable: s.serverReachable,
      streamLive: s.streamLive,
      restarting: s.restarting,
      sessionAuthFailed: s.sessionAuthFailed,
      hasSnapshot: s.hasSnapshot,
      lastLiveAt: s.lastLiveAt,
    })),
  );
  const phase = deriveConnectionPhase(inputs);
  const outage = isWriteBlockedPhase(phase);

  // Queries that exhausted their retries during the outage keep their errors
  // in cache, so refetch everything once the server answers again. The health
  // poll can recover without the RPC socket ever dropping, in which case no
  // `overdeck:reconnected` event fires.
  const queryClient = useQueryClient();
  const wasOutage = useRef(outage);
  useEffect(() => {
    if (wasOutage.current && !outage) void queryClient.invalidateQueries();
    wasOutage.current = outage;
  }, [outage, queryClient]);

  if (showFirstLoadScreen(inputs)) return <FirstLoadScreen phase={phase} />;
  return <>{children}</>;
}

function FirstLoadScreen({ phase }: { phase: ConnectionPhase }) {
  return (
    <div
      role="status"
      data-component="first-load-screen"
      className="flex h-full w-full items-center justify-center bg-background p-8"
    >
      <div className="flex max-w-md items-start gap-3 text-left">
        <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-medium text-foreground">
            {phase === 'restarting'
              ? 'Overdeck server is restarting'
              : phase === 'unauthorized'
                ? 'Dashboard session could not be established'
                : "Can't reach the Overdeck server"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {phase === 'unauthorized'
              ? "The server refused this browser's session. See docs/DASHBOARD-AUTH.md."
              : 'The dashboard will load as soon as the server answers.'}
          </p>
          <button
            type="button"
            onClick={() => useConnectionState.getState().requestReconnect()}
            className="mt-3 rounded-md border border-border px-3 py-1 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
