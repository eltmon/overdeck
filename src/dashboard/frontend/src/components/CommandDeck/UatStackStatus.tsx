import { Check, Circle, ExternalLink, Loader2, X } from 'lucide-react';
import type { WorkspaceContainerStatus, WorkspaceStackHealth } from './ZoneCOverviewTabs/queries';
import styles from './styles/command-deck.module.css';

type Density = 'compact' | 'full' | 'tree';
export type UatContainerState = 'healthy' | 'starting' | 'unhealthy' | 'stopped' | 'unknown';
export type UatStackState = 'healthy' | 'starting' | 'unhealthy' | 'stopped' | 'stale';
export type UatStackLifecycle = 'active' | 'merged' | 'idle';

interface UatStackStatusProps {
  containers?: Record<string, WorkspaceContainerStatus> | null;
  stackHealth?: WorkspaceStackHealth;
  frontendUrl?: string;
  apiUrl?: string;
  pending?: boolean;
  lifecycle?: UatStackLifecycle;
  density?: Density;
  className?: string;
}

export interface UatStackSummary {
  label: string;
  healthyCount: number;
  totalCount: number;
  active: boolean;
  state: UatStackState;
}

export function normalizeStatus(status: WorkspaceContainerStatus): UatContainerState {
  if (!status.running && status.status?.toLowerCase().includes('exited')) {
    return status.lastFailureReason ? 'unhealthy' : 'stopped';
  }
  if (status.health === 'healthy') return 'healthy';
  if (status.health === 'starting') return 'starting';
  if (status.health === 'unhealthy') return 'unhealthy';
  if (!status.running) {
    if (status.lastFailureReason) return 'unhealthy';
    return 'stopped';
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

function statusDotClass(status: WorkspaceContainerStatus): string {
  switch (normalizeStatus(status)) {
    case 'healthy':
      return styles.uatStackContainerDotHealthy;
    case 'starting':
      return styles.uatStackContainerDotStarting;
    case 'unhealthy':
      return styles.uatStackContainerDotUnhealthy;
    default:
      return styles.uatStackContainerDotStopped;
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
  return name.replace(/^overdeck-feature-[^-]+-\d+-?/, '');
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
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatStoppedAge(entries: Array<[string, WorkspaceContainerStatus]>): string | null {
  const newestProbe = entries
    .map(([, status]) => status.lastProbeAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const formatted = formatLastProbe(newestProbe);
  return formatted ? formatted.replace(/\s+ago$/, '') : null;
}

function containerStatusText(status: WorkspaceContainerStatus): string {
  if (status.uptime) return `Up ${status.uptime}`;
  if (status.status) {
    const lastProbe = formatLastProbe(status.lastProbeAt);
    return lastProbe ? `${status.status} ${lastProbe}` : status.status;
  }
  return status.running ? statusLabel(status) : 'not running';
}

export function resolveUatStackState({
  containers,
  stackHealth,
  pending,
  lifecycle = 'active',
}: Pick<UatStackStatusProps, 'containers' | 'stackHealth' | 'pending' | 'lifecycle'>): UatStackState | null {
  if (lifecycle === 'merged' || lifecycle === 'idle') return 'stale';

  const entries = Object.entries(containers ?? {});
  if (entries.length === 0 && stackHealth?.healthy === undefined && !pending) return null;
  if (pending) return 'starting';

  const states = entries.map(([, status]) => normalizeStatus(status));
  if (entries.length > 0 && states.every(state => state === 'stopped')) return 'stopped';
  if (states.includes('starting')) return 'starting';
  if (states.includes('unhealthy') || stackHealth?.healthy === false) return 'unhealthy';
  if (stackHealth?.healthy === true || (entries.length > 0 && states.every(state => state === 'healthy'))) return 'healthy';
  if (states.includes('stopped')) return 'stopped';
  return 'healthy';
}

export function getUatStackSummary({
  containers,
  stackHealth,
  pending,
  lifecycle,
}: Pick<UatStackStatusProps, 'containers' | 'stackHealth' | 'pending' | 'lifecycle'>): UatStackSummary | null {
  const entries = Object.entries(containers ?? {});
  const totalCount = entries.length;
  const healthyCount = entries.filter(([, status]) => normalizeStatus(status) === 'healthy').length;
  const state = resolveUatStackState({ containers, stackHealth, pending, lifecycle });
  if (!state) return null;

  const active = state === 'starting' || state === 'unhealthy';
  if (state === 'stale') {
    return { label: 'UAT stack merged · idle', healthyCount, totalCount, active: false, state };
  }
  if (state === 'healthy') {
    return { label: totalCount > 0 ? `UAT stack ${healthyCount}/${totalCount} healthy` : 'UAT stack healthy', healthyCount, totalCount, active, state };
  }
  if (state === 'starting') {
    return { label: totalCount > 0 ? `UAT stack ${healthyCount}/${totalCount} healthy` : 'UAT stack rebuilding', healthyCount, totalCount, active, state };
  }
  if (state === 'unhealthy') {
    return { label: totalCount > 0 ? `UAT stack ${healthyCount}/${totalCount} unhealthy` : 'UAT stack unhealthy', healthyCount, totalCount, active, state };
  }
  const stoppedAge = formatStoppedAge(entries);
  return {
    label: stoppedAge ? `UAT stack stopped ${stoppedAge}` : 'UAT stack stopped',
    healthyCount,
    totalCount,
    active,
    state,
  };
}

function SummaryIcon({ summary }: { summary: UatStackSummary }) {
  if (summary.state === 'starting') return <Loader2 className="h-3.5 w-3.5 animate-spin text-warning" />;
  if (summary.state === 'healthy') return <Check className="h-3.5 w-3.5 text-success" />;
  if (summary.state === 'unhealthy') return <X className="h-3.5 w-3.5 text-destructive" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

function summaryTone(summary: UatStackSummary): string {
  switch (summary.state) {
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

export function UatStackStatus({
  containers,
  stackHealth,
  frontendUrl,
  apiUrl,
  pending,
  lifecycle = 'active',
  density = 'full',
  className = '',
}: UatStackStatusProps) {
  const entries = Object.entries(containers ?? {}).sort((a, b) => containerSortKey(a).localeCompare(containerSortKey(b)));
  const summary = getUatStackSummary({ containers, stackHealth, pending, lifecycle });
  if (!summary) return null;

  const reason = summary.state === 'unhealthy' || summary.state === 'starting' ? stackHealth?.reasons?.[0] : undefined;
  const showDetails = density === 'full' || pending || summary.state === 'unhealthy' || summary.state === 'starting';
  const lastProbe = entries
    .map(([, status]) => formatLastProbe(status.lastProbeAt))
    .find(Boolean);

  if (density === 'tree') {
    return (
      <div className={`${styles.uatStackTreeBody} ${className}`} data-testid="uat-stack-status">
        {reason && <p className={styles.uatStackTreeReason}>{reason}</p>}
        {entries.map(([name, status]) => (
          <div key={name} className={styles.uatStackContainerRow}>
            <span className={`${styles.uatStackContainerDot} ${statusDotClass(status)}`} aria-hidden="true" />
            <span className={styles.uatStackContainerName} title={name}>{friendlyContainerName(name)}</span>
            <span className={`${styles.uatStackContainerState} ${statusTone(status)}`}>{containerStatusText(status)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`rounded-md border border-border bg-muted/20 p-2.5 text-xs ${className}`} data-testid="uat-stack-status">
      <div className="flex flex-wrap items-center gap-2">
        <SummaryIcon summary={summary} />
        <span className={`font-semibold ${summaryTone(summary)}`}>{summary.label}</span>
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
