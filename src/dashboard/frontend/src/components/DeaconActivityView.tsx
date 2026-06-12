import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Shield, RefreshCw, AlertTriangle, Activity as ActivityIcon } from 'lucide-react';
import { DeaconPauseToggle } from './DeaconPauseToggle';

/**
 * Deacon activity view (conv 2441 follow-up). A dedicated, roomy view of what
 * the Deacon — the Cloister lifecycle watchdog — is doing: patrol cadence,
 * specialist health, and a live feed of every patrol action grouped by cycle.
 *
 * Reuses the existing deacon API surface (no backend change):
 *   - GET  /api/deacon/status  — running state, config, specialists, last patrol
 *   - GET  /api/deacon/logs    — in-memory ring buffer of patrol actions
 *   - POST /api/deacon/patrol  — trigger a patrol cycle on demand
 * The compact CommandDeck `DeaconStatus` widget shows a peek of the same data;
 * this is the full page.
 */

interface SpecialistHealthState {
  specialistName: string;
  lastPingTime?: string;
  lastResponseTime?: string;
  consecutiveFailures: number;
  lastForceKillTime?: string;
  forceKillCount: number;
}

interface DeaconStatusData {
  isRunning: boolean;
  config: { patrolIntervalMs: number };
  state: {
    specialists: Record<string, SpecialistHealthState>;
    lastPatrol?: string;
    patrolCycle: number;
  };
  lastPatrol?: {
    cycle: number;
    timestamp: string;
    actions: string[];
    massDeathDetected: boolean;
  } | null;
}

interface DeaconLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'action' | 'error';
  message: string;
  cycle?: number;
}

async function fetchDeaconStatus(): Promise<DeaconStatusData> {
  const res = await fetch('/api/deacon/status');
  if (!res.ok) throw new Error('Failed to fetch deacon status');
  return res.json();
}

async function fetchDeaconLogs(): Promise<{ logs: DeaconLogEntry[] }> {
  const res = await fetch('/api/deacon/logs?limit=200');
  if (!res.ok) throw new Error('Failed to fetch deacon logs');
  return res.json();
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

const LEVEL_STYLES: Record<DeaconLogEntry['level'], { label: string; cls: string }> = {
  info: { label: 'INF', cls: 'text-muted-foreground bg-muted' },
  action: { label: 'ACT', cls: 'text-primary bg-primary/10' },
  warn: { label: 'WRN', cls: 'text-amber-500 bg-amber-500/10' },
  error: { label: 'ERR', cls: 'text-destructive bg-destructive/10' },
};

function specialistDotColor(health: SpecialistHealthState): string {
  if (health.consecutiveFailures >= 3) return 'bg-destructive';
  if (health.consecutiveFailures > 0) return 'bg-amber-500';
  if (health.lastForceKillTime) {
    const killAge = Date.now() - new Date(health.lastForceKillTime).getTime();
    if (killAge < 5 * 60 * 1000) return 'bg-amber-500';
  }
  return 'bg-emerald-500';
}

interface CycleGroup {
  cycle: number | undefined;
  entries: DeaconLogEntry[];
}

/** Group the (newest-first) log feed into contiguous runs of the same patrol cycle. */
function groupByCycle(logs: DeaconLogEntry[]): CycleGroup[] {
  const groups: CycleGroup[] = [];
  for (const entry of logs) {
    const last = groups[groups.length - 1];
    if (last && last.cycle === entry.cycle) {
      last.entries.push(entry);
    } else {
      groups.push({ cycle: entry.cycle, entries: [entry] });
    }
  }
  return groups;
}

export function DeaconActivityView() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ['deacon-status'],
    queryFn: fetchDeaconStatus,
    refetchInterval: 10000,
  });

  const { data: logData } = useQuery({
    queryKey: ['deacon-logs-full'],
    queryFn: fetchDeaconLogs,
    refetchInterval: 5000,
  });

  const runPatrol = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/deacon/patrol', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to trigger patrol');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deacon-status'] });
      queryClient.invalidateQueries({ queryKey: ['deacon-logs-full'] });
    },
  });

  const specialists = useMemo(
    () => Object.values(status?.state.specialists || {}),
    [status],
  );

  // Newest first for the feed.
  const groups = useMemo(
    () => groupByCycle([...(logData?.logs || [])].reverse()),
    [logData],
  );

  const intervalSec = status ? Math.round(status.config.patrolIntervalMs / 1000) : null;

  return (
    <div className="w-full h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Shield
            className={`w-6 h-6 ${status?.isRunning ? 'text-emerald-500' : 'text-muted-foreground'}`}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold">Deacon</h1>
            <p className="text-xs text-muted-foreground">
              Cloister lifecycle watchdog — patrols, auto-resumes, and janitor actions
            </p>
          </div>
          <DeaconPauseToggle />
          <button
            onClick={() => runPatrol.mutate()}
            disabled={runPatrol.isPending || !status?.isRunning}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-foreground hover:bg-card transition-colors disabled:opacity-50"
            title={status?.isRunning ? 'Run a patrol cycle now' : 'Deacon is stopped'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runPatrol.isPending ? 'animate-spin' : ''}`} />
            Run patrol
          </button>
        </div>

        {/* Status strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Stat label="Status" value={status ? (status.isRunning ? 'Running' : 'Stopped') : '—'}
            valueClass={status?.isRunning ? 'text-emerald-500' : 'text-muted-foreground'} />
          <Stat label="Patrol cycle" value={status ? `#${status.state.patrolCycle}` : '—'} />
          <Stat label="Last patrol" value={timeAgo(status?.state.lastPatrol)} />
          <Stat label="Interval" value={intervalSec != null ? `${intervalSec}s` : '—'} />
        </div>

        {status?.lastPatrol?.massDeathDetected && (
          <div className="flex items-center gap-2 mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Mass-death detected on the last patrol — auto-resume was held back as a safety brake.
          </div>
        )}

        {/* Specialists */}
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Specialist health
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
          {specialists.length === 0 ? (
            <div className="col-span-full text-xs text-muted-foreground">No specialists tracked yet.</div>
          ) : (
            specialists.map((spec) => (
              <div key={spec.specialistName} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${specialistDotColor(spec)}`} />
                <span className="text-xs text-foreground truncate flex-1">
                  {spec.specialistName.replace('-agent', '')}
                </span>
                {spec.consecutiveFailures > 0 && (
                  <span className="text-[10px] text-amber-500" title="consecutive failures">
                    {spec.consecutiveFailures}×
                  </span>
                )}
                {spec.forceKillCount > 0 && (
                  <span className="text-[10px] text-muted-foreground" title="force-kills">
                    ⊘{spec.forceKillCount}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Activity feed */}
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <ActivityIcon className="w-3.5 h-3.5" /> Patrol activity
        </h2>
        <div className="rounded-md border border-border bg-card divide-y divide-border">
          {groups.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No patrol activity yet — waiting for the next cycle.
            </div>
          ) : (
            groups.map((group, gi) => (
              <div key={gi} className="px-3 py-2">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.cycle != null ? `Cycle #${group.cycle}` : 'Uncycled'}
                </div>
                <div className="space-y-1">
                  {group.entries.map((entry, ei) => {
                    const lvl = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.info;
                    return (
                      <div key={ei} className="flex items-start gap-2 text-xs">
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 mt-0.5">
                          {formatLogTime(entry.timestamp)}
                        </span>
                        <span className={`text-[9px] font-semibold rounded px-1 py-0.5 shrink-0 mt-0.5 ${lvl.cls}`}>
                          {lvl.label}
                        </span>
                        <span className="text-foreground break-words min-w-0">{entry.message}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium ${valueClass ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}
