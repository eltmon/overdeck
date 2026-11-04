/**
 * Overdeck on your tailnet (PAN-1254 W-15): the other tailnet machines whose
 * environment descriptor answered. Probing every peer costs a few seconds, so
 * the panel fetches `GET /api/tailscale/peers` on mount and on Refresh only,
 * never on a timer. Linking machines arrives with machine links (#4645); until
 * then there is no Link action.
 */
import { useCallback, useEffect, useState } from 'react';

import { apiError, isOk } from './anywhereApi';
import { fetchPeers, type TailnetPeer } from './tailscaleApi';

const SECONDARY_BUTTON = 'shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50';

export function TailscalePeersPanel() {
  const [peers, setPeers] = useState<TailnetPeer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPeers();
      if (isOk(result)) setPeers(result.body.peers);
      else setError(apiError(result));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const overdeck = (peers ?? []).filter((peer) => peer.overdeck !== null);
  const others = (peers ?? []).length - overdeck.length;

  return (
    <div data-component="tailscale-peers-panel">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">Overdeck on your tailnet</h3>
        <button type="button" className={SECONDARY_BUTTON} disabled={loading} onClick={() => void load()}>Refresh</button>
      </div>
      {error ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Could not look for tailnet machines: {error}</p>
      ) : peers === null ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Looking for other machines…</p>
      ) : (
        <>
          {overdeck.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 py-3">No other machine on your tailnet runs Overdeck.</p>
          ) : (
            <ul className="space-y-1">
              {overdeck.map((peer) => (
                <li key={peer.overdeck!.environmentId} className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground">{peer.overdeck!.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{peer.hostName} · {peer.overdeck!.serverVersion}</span>
                  </div>
                  <a href={peer.overdeck!.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline font-mono break-all">
                    {peer.overdeck!.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {others > 0 && (
            <p className="text-xs text-muted-foreground px-4 pt-1">
              {others} other tailnet {others === 1 ? 'device does' : 'devices do'} not run Overdeck
            </p>
          )}
          <p className="text-xs text-muted-foreground px-4 pt-1">Linking machines arrives with machine links (#4645).</p>
        </>
      )}
    </div>
  );
}
