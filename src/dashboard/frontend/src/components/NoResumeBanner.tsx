import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useAlert } from './DialogProvider';

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

async function resumeAll(): Promise<{ resumed: string[]; count: number }> {
  const res = await fetch('/api/resume-all', { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `POST /api/resume-all → ${res.status}`);
  }
  return res.json();
}

function formatBootTime(since: string | null): string {
  if (!since) return 'startup';
  const time = new Date(since);
  if (Number.isNaN(time.getTime())) return since;
  return time.toLocaleString();
}

export function NoResumeBanner() {
  const queryClient = useQueryClient();
  const showAlert = useAlert();
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
    window.addEventListener('overdeck:reconnected', refetch);
    return () => window.removeEventListener('overdeck:reconnected', refetch);
  }, [queryClient]);

  const resumeMutation = useMutation({
    mutationFn: resumeAll,
    onSuccess: ({ count }) => {
      void queryClient.invalidateQueries({ queryKey: NO_RESUME_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      showAlert({
        message:
          count > 0
            ? `Resuming ${count} agent${count === 1 ? '' : 's'} — auto-resume is now on for this session.`
            : 'Auto-resume is now on. No stopped agents needed resuming.',
        variant: 'success',
      });
    },
    onError: (error: Error) => {
      showAlert({ message: `Resume all failed: ${error.message}`, variant: 'error' });
    },
  });

  if (data?.active !== true) return null;

  const pending = resumeMutation.isPending;

  return (
    <div
      className="sticky top-0 z-40 bg-orange-950/70 border-b-2 border-orange-400/70 px-4 py-2 flex items-center gap-3 shrink-0"
      data-testid="no-resume-banner"
    >
      <Play className="w-5 h-5 text-orange-300 shrink-0" />
      <p className="text-orange-100 text-sm font-medium flex-1">
        Agents are paused — Overdeck started without auto-resume (the standard, safe
        startup since {formatBootTime(data.since)}). They will not pick up work until
        you start them. Click <span className="font-semibold">Resume all</span> to put
        every stopped agent back to work, or use{' '}
        <code className="font-mono text-xs bg-orange-500/20 px-1 rounded">pan start &lt;id&gt;</code>{' '}
        to spawn one individually.
      </p>
      <button
        type="button"
        onClick={() => resumeMutation.mutate()}
        disabled={pending}
        data-testid="no-resume-resume-all"
        className="shrink-0 inline-flex items-center gap-1.5 h-[32px] rounded-[var(--radius-sm)] bg-orange-400 px-[14px] text-[12px] font-medium text-orange-950 transition-opacity hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Play className="w-3.5 h-3.5" />
        {pending ? 'Resuming…' : 'Resume all'}
      </button>
    </div>
  );
}
