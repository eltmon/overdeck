import type { ResourceStack } from '../../types';
import { pipelineChipFor } from '../CommandDeck/pipeline-helpers';

interface StackCardProps {
  stack: ResourceStack;
  expanded?: boolean;
  onToggle?: (stackId: string) => void;
}

export function StackCard({ stack, expanded = false, onToggle }: StackCardProps) {
  const chip = pipelineChipFor({
    phase: stack.phase === 'merged' ? 'ship' : stack.phase,
    feature: {
      id: stack.issueId ?? stack.id,
      title: stack.issueTitle,
      state: stack.phase === 'merged' ? 'closed' : undefined,
      status: stack.phase === 'merged' ? 'closed' : undefined,
    } as any,
    reviewStatus: stack.phase === 'merged' ? { mergeStatus: 'merged' } as any : undefined,
  });
  const idleHint = shouldShowIdleHint(stack);
  const atLimit = stack.services.some((service) => (service.memPercentOfLimit ?? 0) >= 95);
  const dimmed = stack.phase === 'merged' && stack.services.every((service) => service.status === 'stopped');

  return (
    <article className={`border border-border bg-background ${dimmed ? 'opacity-70' : ''}`} data-testid="stack-card">
      <button
        type="button"
        className="grid w-full grid-cols-[1fr_auto] gap-4 px-4 py-3 text-left hover:bg-muted/40"
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
        <div className="text-right font-['DM_Mono'] text-xs text-muted-foreground">
          <div>{stack.serviceCount} services</div>
          <div>{formatBytes(stack.aggregates.diskBytes)} disk</div>
        </div>
      </button>
      <div className="grid gap-3 border-t border-border px-4 py-3 md:grid-cols-2">
        <Meter label="CPU" value={stack.aggregates.cpuPercent} suffix="%" />
        <Meter label="RAM" value={stackMemoryPercent(stack)} suffix="%" detail={formatBytes(stack.aggregates.memoryBytes)} />
      </div>
      {idleHint && (
        <div className="mx-4 mb-3 flex items-center justify-between border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          <span>Idle stack holding {formatBytes(stack.aggregates.memoryBytes)}</span>
          <button type="button" className="border border-amber-500 px-2 py-1 font-['DM_Mono'] text-xs uppercase">Pause</button>
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
          <button type="button" className="border border-border px-2 py-1 font-['DM_Mono'] text-xs uppercase text-foreground">Start</button>
          <span>Tear down · frees {formatBytes(stack.aggregates.diskBytes)}</span>
        </div>
      )}
      {expanded && (
        <div className="divide-y divide-border border-t border-border" data-testid="stack-services">
          {stack.services.map((service) => (
            <div key={service.id} className="grid grid-cols-[1fr_96px_120px] items-center gap-3 px-4 py-3 text-sm">
              <span className="truncate font-medium text-foreground">{service.name}</span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground">{service.status}</span>
              <ServiceLimit service={service} />
            </div>
          ))}
        </div>
      )}
    </article>
  );
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
