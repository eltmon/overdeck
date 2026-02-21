import { useQuery } from '@tantml:react-query';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface TldrDaemonStatus {
  workspace: string;
  running: boolean;
  pid?: number;
  healthy: boolean;
  workspacePath: string;
}

interface TldrStatusResponse {
  daemons: TldrDaemonStatus[];
}

async function fetchTldrStatus(): Promise<TldrStatusResponse> {
  const res = await fetch('/api/services/tldr/status');
  if (!res.ok) throw new Error('Failed to fetch TLDR status');
  return res.json();
}

export function TldrServiceStatus() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tldr-status'],
    queryFn: fetchTldrStatus,
    refetchInterval: 10000, // Refresh every 10s
  });

  if (isLoading) {
    return (
      <div className="bg-surface-raised rounded-lg p-4 border border-divider">
        <div className="flex items-center gap-2 text-content-subtle">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading TLDR status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface-raised rounded-lg p-4 border border-divider">
        <div className="flex items-center gap-2 text-red-400">
          <XCircle className="w-4 h-4" />
          <span className="text-sm">TLDR status unavailable</span>
        </div>
      </div>
    );
  }

  if (!data || data.daemons.length === 0) {
    return (
      <div className="bg-surface-raised rounded-lg p-4 border border-divider">
        <div className="flex items-center gap-2 text-content-subtle">
          <XCircle className="w-4 h-4" />
          <span className="text-sm">TLDR not configured</span>
          <span className="text-xs text-content-muted ml-auto">Run pan setup to enable</span>
        </div>
      </div>
    );
  }

  // Find main daemon
  const mainDaemon = data.daemons.find(d => d.workspace === 'main');
  if (!mainDaemon) {
    return null;
  }

  const isHealthy = mainDaemon.running && mainDaemon.healthy;

  return (
    <div className={`rounded-lg p-4 border ${isHealthy ? 'bg-green-900/30 border-green-800/30' : 'bg-surface-raised border-divider'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isHealthy ? (
            <CheckCircle className="w-5 h-5 text-green-400" />
          ) : (
            <XCircle className="w-5 h-5 text-gray-400" />
          )}
          <div>
            <div className="font-medium text-content">TLDR Code Analysis</div>
            <div className="text-sm text-content-subtle">
              {mainDaemon.running ? 'Running' : 'Stopped'}
              {mainDaemon.running && mainDaemon.pid && ` (PID ${mainDaemon.pid})`}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-content-muted">
            {data.daemons.length - 1} workspace daemon{data.daemons.length - 1 !== 1 ? 's' : ''}
          </div>
          <div className="text-xs text-content-subtle">
            {mainDaemon.healthy ? 'Healthy' : 'Unhealthy'}
          </div>
        </div>
      </div>
    </div>
  );
}
