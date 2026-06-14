import { Check, Circle, ExternalLink, Loader2, X } from 'lucide-react';
import type { WorkspaceContainerStatus, WorkspaceStackHealth } from './ZoneCOverviewTabs/queries';

type Density = 'compact' | 'full';

interface UatStackStatusProps {
  containers?: Record<string, WorkspaceContainerStatus> | null;
  stackHealth?: WorkspaceStackHealth;
  frontendUrl?: string;
  apiUrl?: string;
  pending?: boolean;
  density?: Density;
  className?: string;
}

function normalizeStatus(status: WorkspaceContainerStatus): 'healthy' | 'starting' | 'unhealthy' | 'stopped' | 'unknown' {
  if (status.health === 'healthy') return 'healthy';
  if (status.health === 'starting') return 'starting';
  if (status.health === 'unhealthy') return 'unhealthy';
  if (!status.running) {
    return status.status?.startsWith('exited') ? 'unhealthy' : 'stopped';
  }
  if (status.health === 'unknown') return 'unknown';
  return 'healthy';
}

function statusLabel(status: WorkspaceContainerStatus): string {
  const normalized = normalizeStatus(status);
  if (normalized === 'stopped' && status.status) return status.status;
  return normalized;
}

function statusTone(status: WorkspaceContainerStatus): string {
  switch (normalizeStatus(status)) {
    case 'healthy':
      return 'text-success';
    case 'starting':
      return 'text-warning';
    case 'unhealthy':
      return 'text-destructive';
    default:
      return 'text-muted-foreground';
  }
}

function StatusIcon({ status, pending }: { status: WorkspaceContainerStatus; pending?: boolean }) {
  const normalized = normalizeStatus(status);
  if (pending || normalized === 'starting') return <Loader2 className="h-3 w-3 animate-spin text-warning" />;
  if (normalized === 'healthy') return <Check className="h-3 w-3 text-success" />;
  if (normalized === 'unhealthy') return <X className="h-3 w-3 text-destructive" />;
  return <Circle className="h-3 w-3 text-muted-foreground" />;
}

function friendlyContainerName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('postgres') || lower.includes('db')) return 'postgres';
  if (lower.includes('redis')) return 'redis';
  if (lower.includes('api')) return 'api';
  if (lower.includes('frontend') || lower.includes('fe')) return 'frontend';
  if (lower.includes('server')) return 'server';
  return name.replace(/^panopticon-feature-[^-]+-\d+-?/, '');
}

function containerSortKey([name]: [string, WorkspaceContainerStatus]): string {
  const friendly = friendlyContainerName(name);
  const order = ['postgres', 'redis', 'api', 'frontend', 'server'];
  const idx = order.indexOf(friendly);
  return `${idx === -1 ? 99 : idx}:${friendly}:${name}`;
}

function formatLastProbe(value?: string): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  const seconds = Math.max(1, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function getUatStackSummary({
  containers,
  stackHealth,
  pending,
}: Pick<UatStackStatusProps, 'containers' | 'stackHealth' | 'pending'>): { label: string; healthyCount: number; totalCount: number; active: boolean } | null {
  const entries = Object.entries(containers ?? {});
  const totalCount = entries.length;
  const healthyCount = entries.filter(([, status]) => normalizeStatus(status) === 'healthy').length;
  const active = Boolean(pending || stackHealth?.healthy === false || entries.some(([, status]) => ['starting', 'stopped', 'unhealthy'].includes(normalizeStatus(status))));

  if (totalCount === 0 && stackHealth?.healthy === undefined && !pending) return null;
  if (stackHealth?.healthy === true && totalCount === 0) {
    return { label: 'UAT stack healthy', healthyCount: 0, totalCount: 0, active: false };
  }
  if (pending) {
    return { label: totalCount > 0 ? `UAT stack ${healthyCount}/${totalCount} healthy` : 'UAT stack rebuilding', healthyCount, totalCount, active: true };
  }
  if (stackHealth?.healthy === false) {
    return { label: totalCount > 0 ? `UAT stack ${healthyCount}/${totalCount} healthy` : 'UAT stack unhealthy', healthyCount, totalCount, active: true };
  }
  if (totalCount > 0) {
    return { label: `UAT stack ${healthyCount}/${totalCount} healthy`, healthyCount, totalCount, active };
  }
  return null;
}

export function UatStackStatus({
  containers,
  stackHealth,
  frontendUrl,
  apiUrl,
  pending,
  density = 'full',
  className = '',
}: UatStackStatusProps) {
  const entries = Object.entries(containers ?? {}).sort((a, b) => containerSortKey(a).localeCompare(containerSortKey(b)));
  const summary = getUatStackSummary({ containers, stackHealth, pending });
  if (!summary) return null;

  const reason = stackHealth?.healthy === false ? stackHealth.reasons?.[0] : undefined;
  const showDetails = density === 'full' || pending || stackHealth?.healthy === false;
  const lastProbe = entries
    .map(([, status]) => formatLastProbe(status.lastProbeAt))
    .find(Boolean);

  return (
    <div className={`rounded-md border border-border bg-muted/20 p-2.5 text-xs ${className}`} data-testid="uat-stack-status">
      <div className="flex flex-wrap items-center gap-2">
        {pending || summary.active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-warning" /> : <Check className="h-3.5 w-3.5 text-success" />}
        <span className="font-semibold text-foreground">{summary.label}</span>
        {lastProbe && <span className="text-[11px] text-muted-foreground">last probe {lastProbe}</span>}
        {frontendUrl && stackHealth?.healthy === true && (
          <a href={frontendUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] text-info-foreground hover:underline">
            UAT <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {reason && <p className="mt-1.5 text-[11px] text-muted-foreground">{reason}</p>}
      {showDetails && entries.length > 0 && (
        <div className="mt-2 grid gap-1.5">
          {entries.map(([name, status]) => (
            <div key={name} className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded border border-border/70 bg-background/70 px-2 py-1.5">
              <StatusIcon status={status} pending={pending && normalizeStatus(status) !== 'healthy'} />
              <span className="min-w-0 truncate font-medium text-foreground" title={name}>{friendlyContainerName(name)}</span>
              <span className={`text-[11px] ${statusTone(status)}`}>{statusLabel(status)}</span>
              <span className="col-start-2 col-span-2 min-w-0 truncate text-[11px] text-muted-foreground">
                {status.uptime ? `Up ${status.uptime}` : status.status || 'not running'}
                {status.ports?.length ? ` · ports ${status.ports.join(', ')}` : ''}
                {status.lastFailureReason ? ` · ${status.lastFailureReason}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {density === 'full' && (frontendUrl || apiUrl) && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {frontendUrl && (
            <a href={frontendUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-info-foreground hover:underline">
              Frontend <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {apiUrl && (
            <a href={apiUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-info-foreground hover:underline">
              API <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
