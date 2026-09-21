import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Snowflake, Play } from 'lucide-react';

/**
 * Global Deacon freeze toggle. Persisted server-side via `/api/deacon/pause`.
 * Two render modes:
 *   - icon-only (sidebar collapsed, bottom-left placement)
 *   - full (sidebar expanded)
 *
 * The banner at the top of the app reads the same query.
 */

const DEACON_PAUSE_QUERY_KEY = ['deacon', 'pause'] as const;

export function useDeaconPause() {
  return useQuery({
    queryKey: DEACON_PAUSE_QUERY_KEY,
    queryFn: async (): Promise<{ paused: boolean }> => {
      const res = await fetch('/api/deacon/pause');
      if (!res.ok) throw new Error(`GET /api/deacon/pause → ${res.status}`);
      return res.json();
    },
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useDeaconPauseMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (paused: boolean): Promise<{ paused: boolean }> => {
      const res = await fetch('/api/deacon/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `POST /api/deacon/pause → ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.setQueryData(DEACON_PAUSE_QUERY_KEY, data);
    },
  });
}

export function DeaconPauseToggle({ compact = false }: { compact?: boolean }) {
  const { data } = useDeaconPause();
  const mutation = useDeaconPauseMutation();
  const paused = data?.paused === true;
  const busy = mutation.isPending;

  const onClick = () => {
    if (busy) return;
    mutation.mutate(!paused);
  };

  const title = paused
    ? 'Deacon is FROZEN — click to resume patrol'
    : 'Freeze Deacon — stop all patrol cycles globally';

  if (compact) {
    // Paused is an attention condition (all automatic patrol/recovery is off),
    // so it reads as a warning pill with a pulsing "!" badge — not the calm
    // informational style. Running is a subtle icon button (PAN-1591).
    return (
      <button
        onClick={onClick}
        disabled={busy}
        className={`relative inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
          paused
            ? 'rounded-md border border-warning/32 bg-warning/8 px-2.5 py-1 text-xs font-medium text-warning-foreground hover:bg-warning/16'
            : 'rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
        title={title}
      >
        <Snowflake className="h-3.5 w-3.5" />
        {paused && <span>Deacon frozen</span>}
        {paused && (
          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 animate-pulse items-center justify-center rounded-full bg-warning text-[9px] font-medium leading-none text-warning-foreground ring-2 ring-background">!</span>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 ${
        paused
          ? 'border-warning/32 bg-warning/8 text-warning-foreground hover:bg-warning/16'
          : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
      title={title}
    >
      {paused ? (
        <>
          <Play className="w-3.5 h-3.5" />
          Resume Deacon
        </>
      ) : (
        <>
          <Snowflake className="w-3.5 h-3.5" />
          Freeze Deacon
        </>
      )}
    </button>
  );
}

/**
 * App-wide banner shown at the top when Deacon is globally paused. Renders
 * nothing when running. Kept deliberately visual — this flag affects every
 * automatic recovery, so operators need an unambiguous "all patrol is off"
 * signal whenever it's set.
 */
export function DeaconPauseBanner() {
  const { data } = useDeaconPause();
  const mutation = useDeaconPauseMutation();
  if (data?.paused !== true) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-warning/32 bg-warning/8 px-4 py-2">
      <Snowflake className="h-5 w-5 shrink-0 text-warning-foreground" />
      <p className="flex-1 text-sm font-medium text-warning-foreground">
        Deacon is frozen — no automatic patrol, recovery, re-dispatch, or auto-completion is running.
      </p>
      <button
        onClick={() => mutation.mutate(false)}
        disabled={mutation.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-warning/32 bg-warning/16 px-3 py-1 text-xs font-medium text-warning-foreground transition-colors hover:bg-warning/24 disabled:opacity-50"
      >
        <Play className="w-3.5 h-3.5" />
        Resume Deacon
      </button>
    </div>
  );
}
