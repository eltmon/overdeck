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
    return (
      <button
        onClick={onClick}
        disabled={busy}
        className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${
          paused
            ? 'text-sky-300 bg-sky-900/60 hover:bg-sky-800/80 border border-sky-500/60'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
        title={title}
      >
        {paused ? <Snowflake className="w-3.5 h-3.5" /> : <Snowflake className="w-3.5 h-3.5" />}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 ${
        paused
          ? 'text-sky-200 bg-sky-900/70 hover:bg-sky-800/80 border border-sky-400/60'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent'
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
    <div className="bg-sky-900/40 border-b-2 border-sky-400/60 px-4 py-2 flex items-center gap-3 shrink-0">
      <Snowflake className="w-5 h-5 text-sky-300 shrink-0" />
      <p className="text-sky-100 text-sm font-semibold flex-1">
        Deacon is frozen — no automatic patrol, recovery, re-dispatch, or auto-completion is running.
      </p>
      <button
        onClick={() => mutation.mutate(false)}
        disabled={mutation.isPending}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-sky-700/60 text-sky-50 border border-sky-300/60 hover:bg-sky-600/70 disabled:opacity-50"
      >
        <Play className="w-3.5 h-3.5" />
        Resume Deacon
      </button>
    </div>
  );
}
