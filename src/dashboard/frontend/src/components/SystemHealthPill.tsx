import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ChevronDown, Cpu, Loader2, MemoryStick, Skull, X } from 'lucide-react';
import { useConfirm } from './DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { useKillAgent } from '../hooks/useKillAgent';
import { useSystemHealth } from '../hooks/useSystemHealth';
import type { SystemHealthConsumer, SystemHealthSnapshot } from '../types';

function formatBytes(bytes: number): string {
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) return `${gib.toFixed(1)} GB`;
  const mib = bytes / (1024 ** 2);
  return `${mib.toFixed(0)} MB`;
}

function severityClasses(severity: SystemHealthSnapshot['severity'] | undefined): string {
  if (severity === 'critical') return 'border-destructive/50 bg-destructive/10 text-destructive';
  if (severity === 'warning') return 'border-warning/40 bg-warning/10 text-warning-foreground';
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
}

function topConsumerLabel(consumer: SystemHealthConsumer): string {
  if (consumer.issueId) return `${consumer.label} · ${consumer.issueId}`;
  if (consumer.currentIssue) return `${consumer.label} · ${consumer.currentIssue}`;
  return consumer.label;
}

function KillButton({ consumer, onSelectLeaked }: { consumer: SystemHealthConsumer; onSelectLeaked: () => void }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { confirmAndKill, isPending: isAgentPending } = useKillAgent(consumer.killTarget?.kind === 'agent' ? consumer.killTarget.agentId : undefined, {
    onSuccess: () => {
      if (consumer.leaked) onSelectLeaked();
    },
  });

  const cleanupMutation = useMutation<{ ok?: boolean; success?: boolean }, Error, void>({
    mutationFn: async () => {
      const target = consumer.killTarget;
      if (!target) throw new Error('No kill target available');

      if (target.kind === 'container') {
        if (!target.containerId) throw new Error('Missing container id');
        const res = await fetch(`/api/resources/docker/container/${target.containerId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to remove container');
        return res.json();
      }

      if (target.kind === 'specialist') {
        if (!target.projectKey || !target.issueId || !target.specialistType) {
          throw new Error('Missing specialist target');
        }
        const res = await fetch(`/api/specialists/${target.projectKey}/${target.issueId}/${target.specialistType}/kill`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to kill specialist');
        return res.json();
      }

      throw new Error('Unsupported kill target');
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['system-health'] });
      if (consumer.leaked) onSelectLeaked();
    },
  });

  const isPending = isAgentPending || cleanupMutation.isPending;
  const target = consumer.killTarget;
  if (!target) return null;

  const title = target.kind === 'container'
    ? `Remove container ${consumer.label}`
    : target.kind === 'specialist'
      ? `Kill specialist ${consumer.label}`
      : `Kill ${consumer.label}`;

  const handleClick = async () => {
    if (target.kind === 'agent') {
      await confirmAndKill();
      return;
    }

    const confirmed = await confirm({
      title: target.kind === 'container' ? 'Remove Container' : 'Kill Specialist',
      message: target.kind === 'container'
        ? `Remove Docker container ${consumer.label}?`
        : `Kill specialist ${consumer.label}?`,
      variant: 'destructive',
      confirmLabel: target.kind === 'container' ? 'Remove' : 'Kill',
    });
    if (confirmed) {
      cleanupMutation.mutate();
    }
  };

  return (
    <button
      onClick={() => void handleClick()}
      disabled={isPending}
      className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
      title={title}
    >
      {isPending ? 'Killing…' : target.kind === 'container' ? 'Remove' : 'Kill'}
    </button>
  );
}

export function SystemHealthPill({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, error } = useSystemHealth();
  const [open, setOpen] = useState(false);
  const [highlightLeakedOnly, setHighlightLeakedOnly] = useState(false);
  const previousSeverity = useRef<SystemHealthSnapshot['severity'] | null>(null);

  useEffect(() => {
    if (!data) return;
    const previous = previousSeverity.current;
    previousSeverity.current = data.severity;
    if (compact || previous == null || previous === data.severity || data.severity !== 'critical') return;

    toast.error('System health is critical', {
      description: data.reasons[0] ?? 'Open the health panel to inspect top consumers and leaked specialists.',
      duration: 10000,
      action: {
        label: 'Open',
        onClick: () => {
          setHighlightLeakedOnly((data.leakedSpecialists?.length ?? 0) > 0);
          setOpen(true);
        },
      },
    });
  }, [compact, data]);

  const leakedFirstConsumers = useMemo(() => {
    const consumers = data?.topConsumers ?? [];
    const sorted = [...consumers].sort((a, b) => Number(b.leaked ?? false) - Number(a.leaked ?? false));
    if (!highlightLeakedOnly) return sorted;
    const leakedOnly = sorted.filter((consumer) => consumer.leaked);
    return leakedOnly.length > 0 ? leakedOnly : sorted;
  }, [data?.topConsumers, highlightLeakedOnly]);

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground ${compact ? 'justify-center px-1.5' : ''}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {!compact && <span>Health</span>}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive ${compact ? 'justify-center px-1.5' : ''}`} title={(error as Error | undefined)?.message ?? 'Failed to load system health'}>
        <AlertTriangle className="h-3.5 w-3.5" />
        {!compact && <span>Health unavailable</span>}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setHighlightLeakedOnly(false);
          setOpen((value) => !value);
        }}
        className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors hover:bg-accent ${severityClasses(data.severity)} ${compact ? 'justify-center px-1.5' : 'justify-between'}`}
        data-testid="system-health-pill"
      >
        <span className="flex items-center gap-2 min-w-0">
          {data.severity === 'critical' ? <Skull className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {!compact && (
            <>
              <span className="font-semibold uppercase tracking-wide">{data.severity}</span>
              <span className="text-muted-foreground">{Math.round(data.summary.memoryUsedPercent)}% mem</span>
            </>
          )}
        </span>
        {!compact && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && !compact && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[22rem] rounded-xl border border-border bg-popover p-3 text-sm shadow-lg">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-foreground">System health</div>
              <div className="text-xs text-muted-foreground">Updated {new Date(data.updatedAt).toLocaleTimeString()}</div>
            </div>
            <button
              onClick={() => {
                setHighlightLeakedOnly(false);
                setOpen(false);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div className="rounded-lg border border-border p-2">
              <div className="flex items-center gap-1 text-muted-foreground"><Cpu className="h-3.5 w-3.5" />CPU</div>
              <div className="mt-1 font-semibold text-foreground">{data.summary.cpuPercent.toFixed(1)}%</div>
              <div className="text-muted-foreground">Load/core {data.summary.loadPerCore1m.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="flex items-center gap-1 text-muted-foreground"><MemoryStick className="h-3.5 w-3.5" />Memory</div>
              <div className="mt-1 font-semibold text-foreground">{formatBytes(data.summary.usedMemoryBytes)} / {formatBytes(data.summary.totalMemoryBytes)}</div>
              <div className="text-muted-foreground">Avail {formatBytes(data.summary.availableMemoryBytes)}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-muted-foreground">Panopticon</div>
              <div className="mt-1 font-semibold text-foreground">{formatBytes(data.summary.panopticonMemoryBytes)}</div>
              <div className="text-muted-foreground">{data.summary.panopticonMemoryPercent.toFixed(1)}% of host RAM</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-muted-foreground">Swap</div>
              <div className="mt-1 font-semibold text-foreground">{data.summary.swapUsedPercent.toFixed(1)}%</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-muted-foreground">Work agents</div>
              <div className="mt-1 font-semibold text-foreground">{data.summary.workAgentCount}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-muted-foreground">Containers</div>
              <div className="mt-1 font-semibold text-foreground">{data.summary.containerCount}</div>
            </div>
          </div>

          {data.reasons.length > 0 && (
            <div className="mb-3 space-y-1 rounded-lg border border-border p-2 text-xs">
              {data.reasons.map((reason) => (
                <div key={reason} className="text-muted-foreground">• {reason}</div>
              ))}
            </div>
          )}

          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top consumers</div>
            <div className="flex items-center gap-2">
              {highlightLeakedOnly && data.summary.leakedSpecialistCount > 0 && (
                <button
                  onClick={() => setHighlightLeakedOnly(false)}
                  className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Show all
                </button>
              )}
              <div className="text-xs text-muted-foreground">Leaked specialists: {data.summary.leakedSpecialistCount}</div>
            </div>
          </div>
          <div className="space-y-2 max-h-72 overflow-auto pr-1">
            {leakedFirstConsumers.map((consumer) => (
              <div key={consumer.id} className={`rounded-lg border p-2 ${consumer.leaked ? 'border-warning/40 bg-warning/10' : 'border-border'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{topConsumerLabel(consumer)}</div>
                    <div className="text-xs text-muted-foreground">{consumer.type} · {consumer.memoryGb.toFixed(2)} GB{consumer.cpuPercent != null ? ` · ${consumer.cpuPercent.toFixed(1)}% CPU` : ''}</div>
                  </div>
                  <KillButton consumer={consumer} onSelectLeaked={() => setHighlightLeakedOnly(true)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
