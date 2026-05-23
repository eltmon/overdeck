import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, WifiOff, XCircle } from 'lucide-react';
import { useDashboardStore } from '../lib/store';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

interface MergeAutoMergeCountdownProps {
  issueId: string;
  executeAt: string;
  onCancel?: () => void;
}

function remainingSecondsUntil(executeAt: string): number {
  return Math.max(0, Math.ceil((new Date(executeAt).getTime() - Date.now()) / 1000));
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

async function cancelAutoMerge(issueId: string): Promise<void> {
  const response = await fetch(`/api/issues/${issueId}/merge/cancel`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ reason: 'manual' }),
  });
  if (!response.ok) throw new Error(`Failed to cancel auto-merge (${response.status})`);
}

export function MergeAutoMergeCountdown({ issueId, executeAt, onCancel }: MergeAutoMergeCountdownProps) {
  const rpcConnected = useDashboardStore((state) => state.rpcConnected);
  const queryClient = useQueryClient();
  const [remainingSeconds, setRemainingSeconds] = useState(() => remainingSecondsUntil(executeAt));
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const updateRemaining = () => remainingSecondsUntil(executeAt);
    const initialRemaining = updateRemaining();
    setRemainingSeconds(initialRemaining);
    if (initialRemaining <= 0) return;

    const interval = setInterval(() => {
      const nextRemaining = updateRemaining();
      setRemainingSeconds(nextRemaining);
      if (nextRemaining <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [executeAt]);

  const cancelMutation = useMutation({
    mutationFn: () => cancelAutoMerge(issueId),
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
      onCancel?.();
    },
    onSettled: () => setCancelling(false),
  });

  if (remainingSeconds <= 0) return null;

  return (
    <div className="flex items-center gap-3 p-3 badge-bg-warning border badge-border-warning rounded-lg">
      {rpcConnected ? <Clock className="w-5 h-5 text-warning" /> : <WifiOff className="w-5 h-5 text-warning" />}

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-sm font-medium text-warning">Auto-merging in</span>
          <span className="text-lg font-mono text-foreground">{formatRemaining(remainingSeconds)}</span>
          {!rpcConnected && (
            <span className="text-xs text-warning">(local view — host may be offline)</span>
          )}
        </div>
        {!rpcConnected && (
          <div className="text-xs text-warning flex items-center gap-1">
            <WifiOff className="w-3 h-3" />
            <span>Connection lost</span>
          </div>
        )}
        {cancelMutation.isError && (
          <div className="text-xs text-destructive">Cancel failed</div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          setCancelling(true);
          cancelMutation.mutate();
        }}
        disabled={cancelling || cancelMutation.isPending}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded font-medium text-destructive hover:text-destructive/80 hover:bg-destructive/10 disabled:opacity-50"
        title="Cancel auto-merge"
      >
        {cancelling || cancelMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
        {cancelling || cancelMutation.isPending ? 'Cancelling…' : 'Cancel'}
      </button>
    </div>
  );
}
