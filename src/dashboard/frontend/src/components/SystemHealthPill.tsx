import type {
  HealthReason,
  HealthState,
  SystemHealthConsumer,
  SystemHealthSnapshot,
} from '@overdeck/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  Loader2,
  Skull,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useSystemHealth } from '../hooks/useSystemHealth';
import { useKillAgent } from '../hooks/useKillAgent';
import {
  buildAttentionItems,
  contextNotes,
  reasonLabel,
  summaryLine,
  type AttentionAgentTarget,
} from '../lib/system-health-attention';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { useDashboardStore } from '../lib/store';
import { useConfirm } from './DialogProvider';

const POPOVER_ID = 'system-health-popover';
const POPOVER_TITLE_ID = 'system-health-popover-title';

function formatBytes(bytes: number): string {
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) {
    return `${Number.isInteger(gib) ? gib.toFixed(0) : gib.toFixed(1)} GB`;
  }
  const mib = bytes / (1024 ** 2);
  return `${mib.toFixed(0)} MB`;
}

function stateClasses(state: HealthState): string {
  switch (state) {
    case 'critical':
      return 'border-destructive/50 bg-destructive/10 text-destructive motion-safe:animate-pulse';
    case 'warning':
      return 'border-warning/40 bg-warning/10 text-warning-foreground';
    case 'unavailable':
      return 'border-border bg-muted text-muted-foreground';
    case 'measuring':
      return 'border-info/40 bg-info/10 text-info';
    case 'healthy':
      return 'border-success/40 bg-success/10 text-success';
  }
}

function stateDotClass(state: HealthState): string {
  switch (state) {
    case 'critical':
      return 'bg-destructive';
    case 'warning':
      return 'bg-warning';
    case 'unavailable':
      return 'bg-muted-foreground';
    case 'measuring':
      return 'bg-info';
    case 'healthy':
      return 'bg-success';
  }
}

function topConsumerLabel(consumer: SystemHealthConsumer): string {
  if (consumer.issueId) return `${consumer.label} · ${consumer.issueId}`;
  if (consumer.currentIssue) return `${consumer.label} · ${consumer.currentIssue}`;
  return consumer.label;
}

function topConsumerKindLabel(consumer: SystemHealthConsumer): string {
  switch (consumer.type) {
    case 'agent':
      return 'Agent';
    case 'specialist':
      return 'Specialist';
    case 'container':
      return 'Container';
  }
}

function healthReasons(data: SystemHealthSnapshot): HealthReason[] {
  return [
    ...data.host.reasons,
    ...data.admission.reasons,
    ...data.agents.flatMap((agent) => agent.reasons),
    ...data.services.flatMap((service) => service.reasons),
  ];
}

function firstReasonLabel(data: SystemHealthSnapshot, reasons: readonly HealthReason[]): string | null {
  for (const reason of reasons) {
    const label = reasonLabel(data, reason);
    if (label) return label;
  }
  return null;
}

function healthCopy(data: SystemHealthSnapshot, reasons: readonly HealthReason[]): string {
  switch (data.state) {
    case 'measuring':
      return 'Measuring system health…';
    case 'healthy':
      return data.admission.availableMemoryBytes == null
        ? 'Healthy'
        : `Healthy · ${formatBytes(data.admission.availableMemoryBytes)} available`;
    case 'warning':
      return `Warning · ${firstReasonLabel(data, reasons) ?? 'attention required'}`;
    case 'critical':
      return `Critical · ${firstReasonLabel(data, reasons) ?? 'action required'}`;
    case 'unavailable':
      return 'Health unavailable · Retry';
  }
}

function StateIcon({ state }: { state: HealthState }) {
  switch (state) {
    case 'measuring':
      return <Loader2 data-health-icon="measuring" aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />;
    case 'healthy':
      return <CircleCheck data-health-icon="healthy" aria-hidden="true" className="h-3.5 w-3.5" />;
    case 'warning':
      return <AlertTriangle data-health-icon="warning" aria-hidden="true" className="h-3.5 w-3.5" />;
    case 'critical':
      return <Skull data-health-icon="critical" aria-hidden="true" className="h-3.5 w-3.5" />;
    case 'unavailable':
      return <CircleHelp data-health-icon="unavailable" aria-hidden="true" className="h-3.5 w-3.5" />;
  }
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
    if (confirmed) cleanupMutation.mutate();
  };

  return (
    <button
      onClick={() => void handleClick()}
      disabled={isPending}
      className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      title={title}
    >
      {isPending ? 'Killing…' : target.kind === 'container' ? 'Remove' : 'Kill'}
    </button>
  );
}

function AttentionTargetActions({
  target,
  onOpen,
  onSelectLeaked,
}: {
  target: AttentionAgentTarget;
  onOpen: (issueId: string) => void;
  onSelectLeaked: () => void;
}) {
  if (!target.issueId && !target.killConsumer) return null;

  return (
    <div className="flex gap-1">
      {target.issueId && (
        <button
          type="button"
          onClick={() => onOpen(target.issueId!)}
          className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Open ${target.issueId}`}
        >
          Open
        </button>
      )}
      {target.killConsumer && (
        <KillButton consumer={target.killConsumer} onSelectLeaked={onSelectLeaked} />
      )}
    </div>
  );
}

export function SystemHealthPill({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, error } = useSystemHealth();
  const [open, setOpen] = useState(false);
  const [highlightLeakedOnly, setHighlightLeakedOnly] = useState(false);
  const previousState = useRef<HealthState | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closePopover = useCallback((restoreFocus = true) => {
    setHighlightLeakedOnly(false);
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openAttentionIssue = useCallback((issueId: string) => {
    useDashboardStore.getState().openIssue(issueId);
    closePopover();
  }, [closePopover]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (document.querySelector('[role="alertdialog"]')) return;
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        closePopover();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePopover();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closePopover, open]);

  const reasons = useMemo(() => data ? healthReasons(data) : [], [data]);
  const copy = data ? healthCopy(data, reasons) : 'Health unavailable · Retry';
  const attentionItems = useMemo(() => data ? buildAttentionItems(data) : [], [data]);
  const summary = useMemo(() => data ? summaryLine(data, attentionItems) : '', [data, attentionItems]);
  const notes = useMemo(() => data ? contextNotes(data) : [], [data]);

  useEffect(() => {
    if (!data) return;
    const previous = previousState.current;
    previousState.current = data.state;
    if (compact || previous == null || previous === data.state || data.state !== 'critical') return;

    toast.error('System health is critical', {
      description: reasons[0]?.message ?? 'Open the health panel to inspect top consumers and agent health.',
      duration: 10000,
      action: {
        label: 'Open',
        onClick: () => {
          setHighlightLeakedOnly(data.topConsumers.some((consumer) => consumer.leaked));
          setOpen(true);
        },
      },
    });
  }, [compact, data, reasons]);

  const leakedFirstConsumers = useMemo(() => {
    const consumers = data?.topConsumers ?? [];
    const sorted = [...consumers].sort((a, b) => Number(b.leaked ?? false) - Number(a.leaked ?? false));
    if (!highlightLeakedOnly) return sorted;
    const leakedOnly = sorted.filter((consumer) => consumer.leaked);
    return leakedOnly.length > 0 ? leakedOnly : sorted;
  }, [data?.topConsumers, highlightLeakedOnly]);
  const maxConsumerMemory = useMemo(
    () => leakedFirstConsumers.reduce((max, consumer) => Math.max(max, consumer.memoryGb), 1),
    [leakedFirstConsumers],
  );

  if (isLoading) {
    return (
      <div role="status" className={`flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground ${compact ? 'justify-center px-1.5' : ''}`} aria-label="Loading system health">
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        {!compact && <span>Health</span>}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div role="alert" className={`flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground ${compact ? 'justify-center px-1.5' : ''}`} title={(error as Error | undefined)?.message ?? 'Failed to load system health'} aria-label="Health unavailable">
        <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
        {!compact && <span>Health unavailable · Retry</span>}
      </div>
    );
  }

  const relay = data.services.find((service) => service.id === 'smee-relay' || service.id === 'webhook-relay');
  const relayStatus = relay?.status ?? data.summary.smeeRelay.status;
  const relayConfigured = relayStatus !== 'not_configured'
    && (data.summary.smeeRelay.configured || relay !== undefined);
  const relayPresentation = !relayConfigured
    ? {
        label: 'Not configured',
        classes: 'border-border bg-muted/40',
        dotClass: 'bg-muted-foreground',
      }
    : relayStatus === 'running'
      ? {
          label: 'Running',
          classes: 'border-success/40 bg-success/10',
          dotClass: 'bg-success',
        }
      : {
          label: relayStatus === 'unavailable' ? 'Unavailable' : 'Stopped',
          classes: 'border-destructive/50 bg-destructive/10',
          dotClass: 'bg-destructive',
        };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setHighlightLeakedOnly(false);
          setOpen((value) => !value);
        }}
        className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors hover:bg-accent ${stateClasses(data.state)} ${compact ? 'justify-center px-1.5' : 'justify-between'}`}
        data-testid="system-health-pill"
        aria-label={copy}
        aria-expanded={open}
        aria-controls={POPOVER_ID}
        aria-haspopup="dialog"
      >
        <span className="flex min-w-0 items-center gap-2">
          <StateIcon state={data.state} />
          {!compact && <span>{copy}</span>}
        </span>
        {!compact && <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && !compact && (
        <div
          id={POPOVER_ID}
          role="dialog"
          aria-labelledby={POPOVER_TITLE_ID}
          className="absolute right-0 top-full z-[200] mt-2 w-[min(22rem,calc(100vw-1rem))] max-h-[calc(100vh-1rem)] overflow-auto rounded-xl border border-border bg-popover p-3 text-sm shadow-lg"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span id={POPOVER_TITLE_ID} className="font-semibold text-foreground">System health</span>
                <span
                  role="status"
                  aria-label={`${data.state} system health`}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${stateClasses(data.state)}`}
                >
                  <span aria-hidden="true" className={`inline-flex h-2 w-2 rounded-full ${stateDotClass(data.state)}`} />
                  {data.state}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">Updated {Math.round((Date.now() - Date.parse(data.updatedAt)) / 1000)}s ago</div>
            </div>
            <button
              type="button"
              onClick={() => closePopover()}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close system health"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-3 rounded-lg border border-border bg-muted/30 p-2 text-sm">
            <div className="text-foreground">{summary}</div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-border p-2">
              <div className="text-muted-foreground">CPU</div>
              <div className="mt-1 font-semibold text-foreground">{data.host.metrics.cpuPercent == null ? 'Unavailable' : `${data.host.metrics.cpuPercent.toFixed(1)}%`}</div>
              <div className="mt-1 text-muted-foreground">
                Load/core {data.host.metrics.loadPerCore1m == null ? 'Unavailable' : data.host.metrics.loadPerCore1m.toFixed(2)}
              </div>
              {data.host.metrics.cpuPercent != null && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    role="meter"
                    aria-label="CPU usage"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={data.host.metrics.cpuPercent}
                    className={`h-full ${data.host.metrics.cpuPercent < 60 ? 'bg-success' : data.host.metrics.cpuPercent <= 85 ? 'bg-warning' : 'bg-destructive'}`}
                    style={{ width: `${Math.min(100, data.host.metrics.cpuPercent)}%` }}
                  />
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-muted-foreground">Memory</div>
              <div className="mt-1 font-semibold text-foreground">{data.host.metrics.usedMemoryBytes == null || data.host.metrics.totalMemoryBytes == null ? 'Unavailable' : `${formatBytes(data.host.metrics.usedMemoryBytes)} / ${formatBytes(data.host.metrics.totalMemoryBytes)}`}</div>
              <div className="mt-1 text-muted-foreground">
                Avail {data.host.metrics.availableMemoryBytes == null ? 'Unavailable' : formatBytes(data.host.metrics.availableMemoryBytes)}
              </div>
              {data.host.metrics.memoryUsedPercent != null && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    role="meter"
                    aria-label="Memory usage"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={data.host.metrics.memoryUsedPercent}
                    className={`h-full ${data.host.metrics.memoryUsedPercent < 60 ? 'bg-success' : data.host.metrics.memoryUsedPercent <= 85 ? 'bg-warning' : 'bg-destructive'}`}
                    style={{ width: `${Math.min(100, data.host.metrics.memoryUsedPercent)}%` }}
                  />
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-muted-foreground">Overdeck</div>
              <div className="mt-1 font-semibold text-foreground">{formatBytes(data.summary.overdeckMemoryBytes)}</div>
              <div className="mt-1 text-muted-foreground">{data.summary.overdeckMemoryPercent.toFixed(1)}% of host RAM</div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  role="meter"
                  aria-label="Overdeck memory share"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={data.summary.overdeckMemoryPercent}
                  className="h-full bg-info"
                  style={{ width: `${Math.min(100, data.summary.overdeckMemoryPercent)}%` }}
                />
              </div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-muted-foreground">Swap <span className="text-[11px]">historical · not live pressure</span></div>
              <div className="mt-1 font-semibold text-foreground">{data.host.metrics.swapUsedPercent == null ? 'Unavailable' : `${data.host.metrics.swapUsedPercent.toFixed(1)}%`}</div>
              {data.host.metrics.swapUsedPercent != null && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    role="meter"
                    aria-label="Swap usage"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={data.host.metrics.swapUsedPercent}
                    className={`h-full ${data.host.metrics.swapUsedPercent < 60 ? 'bg-success' : data.host.metrics.swapUsedPercent <= 85 ? 'bg-warning' : 'bg-destructive'}`}
                    style={{ width: `${Math.min(100, data.host.metrics.swapUsedPercent)}%` }}
                  />
                </div>
              )}
              <div className="mt-1 text-muted-foreground">
                Overcommit {data.host.metrics.virtualCommitmentPercent == null ? 'Unavailable' : `${data.host.metrics.virtualCommitmentPercent.toFixed(1)}%`}
              </div>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <div role="group" className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-xs text-foreground" aria-label={`Admitted work agents: ${data.admission.admittedWorkAgentCount}`}>
              <span className="text-muted-foreground">Admitted work agents</span>
              <span>{data.admission.admittedWorkAgentCount}</span>
            </div>
            <div role="group" className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-xs text-foreground" aria-label={`Containers: ${data.summary.containerCount}`}>
              <span className="text-muted-foreground">Containers</span>
              <span>{data.summary.containerCount}</span>
            </div>
            <div role="group" className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs text-foreground ${relayPresentation.classes}`} aria-label={`Webhook relay: ${relayPresentation.label}`}>
              <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${relayPresentation.dotClass}`} />
              <span className="text-muted-foreground">Webhook relay</span>
              <span>{relayPresentation.label}</span>
            </div>
          </div>

          <div className="mb-3">
            {attentionItems.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-border p-2">
                {attentionItems.map((item) => {
                  const singletonTarget = item.targets.length === 1 ? item.targets[0] : undefined;

                  return (
                    <div key={`${item.code}-${item.agents.join(',')}`} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span role="img" className={`inline-block h-2 w-2 rounded-full ${item.severity === 'critical' ? 'bg-destructive' : 'bg-warning'}`} aria-label={`${item.severity} attention`} />
                          <div className="min-w-0 flex-1">
                            <div className="text-foreground">
                              {item.title}
                              {item.agents.length > 1 && <span className="ml-1 text-muted-foreground">×{item.agents.length}</span>}
                            </div>
                            <div className="text-muted-foreground">{item.sub}</div>
                          </div>
                        </div>
                        {singletonTarget && (
                          <AttentionTargetActions
                            target={singletonTarget}
                            onOpen={openAttentionIssue}
                            onSelectLeaked={() => setHighlightLeakedOnly(true)}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-border p-2 text-xs text-foreground">
                No active pressure signals.
              </div>
            )}
            {notes.length > 0 && (
              <details className="mt-2 cursor-pointer text-xs">
                <summary className="text-muted-foreground hover:text-foreground">
                  {notes.length} context note{notes.length !== 1 ? 's' : ''} — background, not pressure signals
                </summary>
                <div className="mt-2 space-y-1 rounded-lg border border-border p-2">
                  {notes.map((note, idx) => (
                    <div key={`${note.code}-${idx}`} className="text-muted-foreground">• {note.message}</div>
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top consumers</div>
            <div className="flex items-center gap-2">
              {highlightLeakedOnly && data.summary.leakedSpecialistCount > 0 && (
                <button
                  type="button"
                  onClick={() => setHighlightLeakedOnly(false)}
                  className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Show all
                </button>
              )}
              <div className="text-xs text-muted-foreground">
                {data.summary.leakedSpecialistCount > 0 ? `⚠ ${data.summary.leakedSpecialistCount} leaked specialist${data.summary.leakedSpecialistCount !== 1 ? 's' : ''}` : 'No leaks'}
              </div>
            </div>
          </div>
          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {leakedFirstConsumers.map((consumer) => {
              const memoryPercent = (consumer.memoryGb / maxConsumerMemory) * 100;
              return (
                <div key={consumer.id} className={`rounded-lg border p-2 ${consumer.leaked ? 'border-warning/40 bg-warning/10' : 'border-border'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium text-foreground">{topConsumerLabel(consumer)}</div>
                        <span role="note" className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" aria-label={`Consumer kind: ${topConsumerKindLabel(consumer)}`}>{topConsumerKindLabel(consumer)}</span>
                        {consumer.leaked && <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-medium text-warning">LEAKED</span>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{consumer.memoryGb.toFixed(2)} GB{consumer.cpuPercent != null ? ` · ${consumer.cpuPercent.toFixed(1)}% CPU` : ''}</div>
                      {memoryPercent > 0 && (
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            role="meter"
                            aria-label={`${consumer.label} memory share: ${memoryPercent.toFixed(1)}%`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Number(memoryPercent.toFixed(1))}
                            className="h-full bg-info"
                            style={{ width: `${memoryPercent}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <KillButton consumer={consumer} onSelectLeaked={() => setHighlightLeakedOnly(true)} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
