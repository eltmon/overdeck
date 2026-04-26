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
      <div className="bg-card rounded-lg p-4 border border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading TLDR status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border">
        <div className="flex items-center gap-2 text-destructive">
          <XCircle className="w-4 h-4" />
          <span className="text-sm">TLDR status unavailable</span>
        </div>
      </div>
    );
  }

  if (!data || data.daemons.length === 0) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          <XCircle className="w-4 h-4" />
          <span className="text-sm">TLDR not configured</span>
          <span className="text-xs text-muted-foreground ml-auto">Run pan admin tldr start to enable</span>
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
    <div className={`rounded-lg p-4 border ${isHealthy ? 'badge-bg-success border-success/30' : 'bg-card border-border'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isHealthy ? (
            <CheckCircle className="w-5 h-5 text-success" />
          ) : (
            <XCircle className="w-5 h-5 text-muted-foreground" />
          )}
          <div>
            <div className="font-medium text-foreground">{label}</div>
            <div className="text-sm text-muted-foreground">
              {daemon.running ? 'Running' : 'Stopped'}
              {daemon.running && daemon.pid && ` (PID ${daemon.pid})`}
            </div>
          </div>
        </div>

        <div className="text-right">
          {daemon.fileCount != null && (
            <div className="flex items-center gap-1 text-sm text-foreground">
              <Database className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{daemon.fileCount.toLocaleString()} files{daemon.edgeCount != null && `, ${daemon.edgeCount.toLocaleString()} edges`}</span>
            </div>
          )}
          {daemon.indexAge && (
            <div className="text-xs text-muted-foreground">
              Updated {daemon.indexAge}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
