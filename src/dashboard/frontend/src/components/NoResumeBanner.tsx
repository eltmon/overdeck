import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

export interface NoResumeMode {
  active: boolean;
  since: string | null;
}

export const NO_RESUME_QUERY_KEY = ['no-resume-mode'] as const;

async function fetchNoResumeMode(): Promise<NoResumeMode> {
  const res = await fetch('/api/no-resume-mode');
  if (!res.ok) throw new Error(`GET /api/no-resume-mode → ${res.status}`);
  return res.json();
}

function formatBootTime(since: string | null): string {
  if (!since) return 'unknown boot time';
  const time = new Date(since);
  if (Number.isNaN(time.getTime())) return since;
  return time.toLocaleString();
}

export function NoResumeBanner() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: NO_RESUME_QUERY_KEY,
    queryFn: fetchNoResumeMode,
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: NO_RESUME_QUERY_KEY });
    };
    window.addEventListener('panopticon:reconnected', refetch);
    return () => window.removeEventListener('panopticon:reconnected', refetch);
  }, [queryClient]);

  if (data?.active !== true) return null;

  return (
    <div
      className="sticky top-0 z-40 bg-orange-950/70 border-b-2 border-orange-400/70 px-4 py-2 flex items-center gap-3 shrink-0"
      data-testid="no-resume-banner"
    >
      <AlertTriangle className="w-5 h-5 text-orange-300 shrink-0" />
      <p className="text-orange-100 text-sm font-semibold flex-1">
        No-resume mode active since {formatBootTime(data.since)} — agents will not auto-start until you restart without <code className="font-mono text-xs bg-orange-500/20 px-1 rounded">--no-resume</code>. Use <code className="font-mono text-xs bg-orange-500/20 px-1 rounded">pan start &lt;id&gt;</code> to spawn individually.
      </p>
    </div>
  );
}
