import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { dashboardMutationJsonHeaders } from '../lib/wsTransport';

interface SyncStatus {
  needed: boolean;
  reason: string;
}

export function SyncRequiredBanner() {
  const status = useQuery({
    queryKey: ['sync-status'],
    queryFn: async (): Promise<SyncStatus> => {
      const response = await fetch('/api/sync-status');
      if (!response.ok) throw new Error('Failed to check Overdeck sync status');
      return response.json();
    },
    refetchInterval: 60_000,
  });
  const runSync = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/system/sync', { method: 'POST', headers: await dashboardMutationJsonHeaders() });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'pan sync failed');
    },
    onSuccess: async () => {
      toast.success('Overdeck context, hooks, and skills are up to date');
      await status.refetch();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'pan sync failed'),
  });

  if (!status.data?.needed) return null;
  return (
    <div className="bg-primary/10 flex flex-1 items-center gap-2 px-4 py-1.5" data-testid="sync-required-banner">
      <RefreshCw className={`w-3.5 h-3.5 text-primary shrink-0 ${runSync.isPending ? 'animate-spin' : ''}`} />
      <p className="flex-1 truncate text-xs text-primary" title="Sync the latest context rules, lifecycle hooks, and skills before starting new agents.">
        <span className="font-medium">Setup changed</span> — sync context, hooks, and skills
      </p>
      <button
        type="button"
        onClick={() => runSync.mutate()}
        disabled={runSync.isPending}
        className="h-[26px] shrink-0 rounded-sm bg-primary px-[10px] text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {runSync.isPending ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  );
}
