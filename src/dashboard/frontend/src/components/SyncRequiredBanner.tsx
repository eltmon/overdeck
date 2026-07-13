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
    <div className="bg-primary/10 border-b border-primary/30 px-4 py-2 flex items-center gap-3 shrink-0">
      <RefreshCw className={`w-4 h-4 text-primary shrink-0 ${runSync.isPending ? 'animate-spin' : ''}`} />
      <p className="text-primary text-sm flex-1">
        <span className="font-semibold">Overdeck setup changed.</span>{' '}
        Sync the latest context rules, lifecycle hooks, and skills before starting new agents.
      </p>
      <button
        type="button"
        onClick={() => runSync.mutate()}
        disabled={runSync.isPending}
        className="px-3 py-1.5 text-sm font-semibold rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {runSync.isPending ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  );
}
