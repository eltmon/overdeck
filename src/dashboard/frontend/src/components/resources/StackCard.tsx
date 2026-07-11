import type { ResourceStack } from '../../types';
import { pipelineChipFor, type BucketedFeature } from '../CommandDeck/pipeline-helpers';
import { ActionButton, type ServiceAction, type StackAction } from './StackActions';

interface StackCardProps {
  stack: ResourceStack;
  expanded?: boolean;
  onToggle?: (stackId: string) => void;
  busyKeys?: ReadonlySet<string>;
  onStackAction?: (stack: ResourceStack, action: StackAction) => void;
  onServiceAction?: (service: ResourceStack['services'][number], action: ServiceAction) => void;
  onServiceLogs?: (service: ResourceStack['services'][number]) => void;
  onServiceTerminal?: (service: ResourceStack['services'][number]) => void;
  onTeardown?: (stack: ResourceStack) => void;
}

export function StackCard({
  stack,
  expanded = false,
  onToggle,
  busyKeys = new Set(),
  onStackAction,
  onServiceAction,
  onServiceLogs,
  onServiceTerminal,
  onTeardown,
}: StackCardProps) {
  const feature: BucketedFeature['feature'] = {
    issueId: stack.issueId ?? stack.id,
    title: stack.issueTitle,
    projectName: '',
    branch: '',
    status: stack.phase === 'merged' ? 'closed' : stack.phase,
    stateLabel: stack.phase,
    agentStatus: null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
  };
  const reviewStatus: BucketedFeature['reviewStatus'] = stack.phase === 'merged'
    ? { issueId: stack.issueId ?? stack.id, mergeStatus: 'merged' }
    : undefined;
  const chip = pipelineChipFor({
    phase: stack.phase === 'merged' ? 'ship' : stack.phase,
    feature,
    reviewStatus,
  });
  const idleHint = shouldShowIdleHint(stack);
  const atLimit = stack.services.some((service) => (service.memPercentOfLimit ?? 0) >= 95);
  const dimmed = stack.phase === 'merged' && stack.services.every((service) => service.status === 'stopped');

  return (
    <article className={`border border-border bg-background ${dimmed ? 'opacity-70' : ''}`} data-testid="stack-card">
      <div className="grid w-full grid-cols-[1fr_auto] gap-4 px-4 py-3">
        <button
          type="button"
          className="text-left hover:bg-muted/40"
          onClick={() => onToggle?.(stack.id)}
          aria-expanded={expanded}
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-['Space_Grotesk'] text-lg font-semibold text-foreground">{stack.issueId ?? 'unassigned'}</h2>
              <span className={`inline-flex items-center gap-1 border px-2 py-0.5 font-['DM_Mono'] text-[11px] uppercase ${chip.ringClass} ${chip.bgClass} ${chip.textClass}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${chip.dotClass} ${chip.animate ? 'animate-pulse' : ''}`} />
                {chip.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{stack.issueTitle}</p>
          </div>
        </button>
        <div className="flex flex-col items-end gap-2">
          <div className="text-right font-['DM_Mono'] text-xs text-muted-foreground">
            <div>{stack.serviceCount} services</div>
            <div>{formatBytes(stack.aggregates.diskBytes)} disk</div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <ActionButton label="Start" busy={busyKeys.has(stackBusyKey(stack, 'start'))} onClick={() => onStackAction?.(stack, 'start')} />
            <ActionButton label="Stop" busy={busyKeys.has(stackBusyKey(stack, 'stop'))} onClick={() => onStackAction?.(stack, 'stop')} tone="danger" />
            <ActionButton label="Pause" busy={busyKeys.has(stackBusyKey(stack, 'pause'))} onClick={() => onStackAction?.(stack, 'pause')} />
            <ActionButton label="Tear down" onClick={() => onTeardown?.(stack)} tone="danger" />
          </div>
        </div>
      </div>
      <div className="grid gap-3 border-t border-border px-4 py-3 md:grid-cols-2">
        <Meter label="CPU" value={stack.aggregates.cpuPercent} suffix="%" />
        <Meter label="RAM" value={stackMemoryPercent(stack)} suffix="%" detail={formatBytes(stack.aggregates.memoryBytes)} />
      </div>
      {idleHint && (
        <div className="mx-4 mb-3 flex items-center justify-between border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          <span>Idle stack holding {formatBytes(stack.aggregates.memoryBytes)}</span>
          <ActionButton label="Pause" busy={busyKeys.has(stackBusyKey(stack, 'pause'))} onClick={() => onStackAction?.(stack, 'pause')} />
        </div>
      )}
      {atLimit && (
        <div className="mx-4 mb-3 flex items-center justify-between border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>Memory limit pressure</span>
          <span className="flex gap-2">
            <button type="button" className="border border-destructive px-2 py-1 font-['DM_Mono'] text-xs uppercase">Raise limit</button>
            <button type="button" className="border border-destructive px-2 py-1 font-['DM_Mono'] text-xs uppercase">Create issue</button>
          </span>
        </div>
      )}
      {dimmed && (
        <div className="mx-4 mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <ActionButton label="Start" busy={busyKeys.has(stackBusyKey(stack, 'start'))} onClick={() => onStackAction?.(stack, 'start')} />
          <ActionButton label="Tear down" onClick={() => onTeardown?.(stack)} tone="danger" />
          <span>Tear down · frees {formatBytes(stack.aggregates.diskBytes)}</span>
        </div>
      )}
      {expanded && (
        <div className="divide-y divide-border border-t border-border" data-testid="stack-services">
          {stack.services.map((service) => (
            <div key={service.id} className="grid grid-cols-[1fr_96px_120px_minmax(260px,auto)] items-center gap-3 px-4 py-3 text-sm">
              <span className="truncate font-medium text-foreground">{service.name}</span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground">{service.status}</span>
              <ServiceLimit service={service} />
              <div className="flex flex-wrap justify-end gap-2">
                <ActionButton label="Start" busy={busyKeys.has(serviceBusyKey(service, 'start'))} onClick={() => onServiceAction?.(service, 'start')} />
                <ActionButton label="Stop" busy={busyKeys.has(serviceBusyKey(service, 'stop'))} onClick={() => onServiceAction?.(service, 'stop')} tone="danger" />
                {service.status === 'paused'
                  ? <ActionButton label="Unpause" busy={busyKeys.has(serviceBusyKey(service, 'unpause'))} onClick={() => onServiceAction?.(service, 'unpause')} />
                  : <ActionButton label="Pause" busy={busyKeys.has(serviceBusyKey(service, 'pause'))} onClick={() => onServiceAction?.(service, 'pause')} />}
                <ActionButton label="Restart" busy={busyKeys.has(serviceBusyKey(service, 'restart'))} onClick={() => onServiceAction?.(service, 'restart')} />
                <ActionButton label="Logs" busy={busyKeys.has(serviceBusyKey(service, 'logs'))} onClick={() => onServiceLogs?.(service)} />
                <ActionButton label="Terminal" onClick={() => onServiceTerminal?.(service)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function stackBusyKey(stack: ResourceStack, action: StackAction) {
  return `stack:${stack.issueId ?? stack.id}:${action}`;
}

export function serviceBusyKey(service: ResourceStack['services'][number], action: ServiceAction | 'logs') {
  return `container:${service.id}:${action}`;
}

function Meter({ label, value, suffix, detail }: { label: string; value: number; suffix: string; detail?: string }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex justify-between font-['DM_Mono'] text-xs uppercase text-muted-foreground">
        <span>{label}</span>
        <span>{Math.round(value)}{suffix}{detail ? ` · ${detail}` : ''}</span>
      </div>
      <div className="mt-1 h-1.5 bg-muted">
        <div className="h-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ServiceLimit({ service }: { service: ResourceStack['services'][number] }) {
  const percent = service.memPercentOfLimit;
  const level = percent !== undefined && percent >= 95 ? 'red' : percent !== undefined && percent >= 85 ? 'amber' : 'normal';
  const className = level === 'red'
    ? 'bg-destructive text-destructive-foreground'
    : level === 'amber'
      ? 'bg-amber-500/14 text-amber-700'
      : 'bg-muted text-muted-foreground';
  return (
    <span className={`justify-self-end px-2 py-1 font-['DM_Mono'] text-xs ${className}`} data-limit-level={level}>
      {percent === undefined ? 'no limit' : `${percent}% limit`}
      {(service.oomKills24h ?? 0) > 0 ? ` · ${service.oomKills24h} OOM` : ''}
    </span>
  );
}

function stackMemoryPercent(stack: ResourceStack) {
  const limit = stack.services.reduce((sum, service) => sum + (service.memLimitBytes ?? service.memoryLimit ?? 0), 0);
  return limit > 0 ? (stack.aggregates.memoryBytes / limit) * 100 : 0;
}

function shouldShowIdleHint(stack: ResourceStack) {
  return stack.aggregates.memoryBytes > 1024 ** 3
    && stack.services.every((service) => service.status === 'running')
    && (stack.idleMinutes ?? 0) >= 120;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${bytes} B`;
}
