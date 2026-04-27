import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ChevronDown, Cpu, Loader2, MemoryStick, Skull, X } from 'lucide-react';
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

function KillButton({ consumer }: { consumer: SystemHealthConsumer }) {
  const killable = consumer.type !== 'container' && consumer.id.startsWith('agent-');
  const { confirmAndKill, isPending } = useKillAgent(killable ? consumer.id : undefined);

  if (!killable) return null;

  return (
    <button
      onClick={() => void confirmAndKill()}
      disabled={isPending}
      className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
      title={`Kill ${consumer.label}`}
    >
      {isPending ? 'Killing…' : 'Kill'}
    </button>
  );
}

export function SystemHealthPill({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, error } = useSystemHealth();
  const [open, setOpen] = useState(false);
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
        onClick: () => setOpen(true),
      },
    });
  }, [compact, data]);

  const leakedFirstConsumers = useMemo(() => {
    const consumers = data?.topConsumers ?? [];
    return [...consumers].sort((a, b) => Number(b.leaked ?? false) - Number(a.leaked ?? false));
  }, [data]);

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
        onClick={() => setOpen((value) => !value)}
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
              onClick={() => setOpen(false)}
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
              <div className="text-muted-foreground">Swap</div>
              <div className="mt-1 font-semibold text-foreground">{data.summary.swapUsedPercent.toFixed(1)}%</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-muted-foreground">Work agents</div>
              <div className="mt-1 font-semibold text-foreground">{data.summary.workAgentCount}</div>
            </div>
          </div>

          {data.reasons.length > 0 && (
            <div className="mb-3 space-y-1 rounded-lg border border-border p-2 text-xs">
              {data.reasons.map((reason) => (
                <div key={reason} className="text-muted-foreground">• {reason}</div>
              ))}
            </div>
          )}

          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top consumers</div>
            <div className="text-xs text-muted-foreground">Leaked specialists: {data.summary.leakedSpecialistCount}</div>
          </div>
          <div className="space-y-2 max-h-72 overflow-auto pr-1">
            {leakedFirstConsumers.map((consumer) => (
              <div key={consumer.id} className={`rounded-lg border p-2 ${consumer.leaked ? 'border-warning/40 bg-warning/10' : 'border-border'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{topConsumerLabel(consumer)}</div>
                    <div className="text-xs text-muted-foreground">{consumer.type} · {consumer.memoryGb.toFixed(2)} GB{consumer.cpuPercent != null ? ` · ${consumer.cpuPercent.toFixed(1)}% CPU` : ''}</div>
                  </div>
                  <KillButton consumer={consumer} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
