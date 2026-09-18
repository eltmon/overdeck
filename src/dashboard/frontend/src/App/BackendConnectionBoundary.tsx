import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { BACKEND_RECONNECTED_EVENT, BACKEND_RECONNECTING_EVENT } from '../lib/backendConnectionEvents';

interface BackendConnectionBoundaryProps {
  backendDown: boolean;
  restarting: boolean;
  children: ReactNode;
}

export function BackendConnectionBoundary({ backendDown, restarting, children }: BackendConnectionBoundaryProps) {
  const [eventRouterReconnecting, setEventRouterReconnecting] = useState(false);

  useEffect(() => {
    const handleReconnecting = () => setEventRouterReconnecting(true);
    const handleReconnected = () => setEventRouterReconnecting(false);
    window.addEventListener(BACKEND_RECONNECTING_EVENT, handleReconnecting);
    window.addEventListener(BACKEND_RECONNECTED_EVENT, handleReconnected);
    return () => {
      window.removeEventListener(BACKEND_RECONNECTING_EVENT, handleReconnecting);
      window.removeEventListener(BACKEND_RECONNECTED_EVENT, handleReconnected);
    };
  }, []);

  // A genuine outage or restart replaces the UI: the snapshot is stale and
  // route views would render definitive-but-wrong states (PAN-3373).
  if (backendDown || restarting) {
    return (
      <div role="status" className="flex h-full w-full items-center justify-center bg-background p-8">
        <div className="flex max-w-md items-start gap-3 text-left">
          <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-medium text-foreground">
              {restarting ? 'Dashboard is restarting' : 'Waiting for backend data'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Live data will return automatically when the backend connection is restored.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // A transient stream reconnect keeps the UI mounted — data is at most a few
  // seconds stale and tearing everything down (terminals, scroll, selection)
  // costs far more than a brief banner.
  return (
    <>
      {children}
      {eventRouterReconnecting && (
        <div
          role="status"
          className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2"
        >
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-md">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            <span>Connection lost — reconnecting…</span>
          </div>
        </div>
      )}
    </>
  );
}
