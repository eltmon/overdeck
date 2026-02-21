import { useQuery } from '@tanstack/react-query';
import { CheckCircle, XCircle, Loader2, Database } from 'lucide-react';

interface TldrDaemonStatus {
  workspace: string;
  running: boolean;
  pid?: number;
  healthy: boolean;
  workspacePath: string;
  fileCount?: number;
  indexAge?: string;
  edgeCount?: number;
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

  const mainDaemon = data.daemons.find(d => d.workspace === 'main');
  const workspaceDaemons = data.daemons.filter(d => d.workspace !== 'main');

  return (
    <div className="space-y-3">
      {/* Main daemon */}
      {mainDaemon && (
        <DaemonCard daemon={mainDaemon} label="Main Index" />
      )}

      {/* Workspace daemons */}
      {workspaceDaemons.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {workspaceDaemons.map(d => (
            <DaemonCard key={d.workspace} daemon={d} label={d.workspace} />
          ))}
        </div>
      )}
    </div>
  );
}

function DaemonCard({ daemon, label }: { daemon: TldrDaemonStatus; label: string }) {
  const isHealthy = daemon.running && daemon.healthy;

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
            <div className="font-medium text-content">{label}</div>
            <div className="text-sm text-content-subtle">
              {daemon.running ? 'Running' : 'Stopped'}
              {daemon.running && daemon.pid && ` (PID ${daemon.pid})`}
            </div>
          </div>
        </div>

        <div className="text-right">
          {daemon.fileCount != null && (
            <div className="flex items-center gap-1 text-sm text-content">
              <Database className="w-3.5 h-3.5 text-content-subtle" />
              <span>{daemon.fileCount.toLocaleString()} files{daemon.edgeCount != null && `, ${daemon.edgeCount.toLocaleString()} edges`}</span>
            </div>
          )}
          {daemon.indexAge && (
            <div className="text-xs text-content-muted">
              Updated {daemon.indexAge}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
