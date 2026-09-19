import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Shield, RefreshCw, AlertTriangle, Activity as ActivityIcon } from 'lucide-react';
import { DeaconPauseToggle } from './DeaconPauseToggle';

/**
 * Deacon activity view (conv 2441 follow-up). A dedicated, roomy view of what
 * the Deacon — the Cloister lifecycle watchdog — is doing.
 *
 * PAN-3917 (W4): deacon-lite keeps no patrol ledger and no specialist health
 * table — no cycle counter, no per-specialist failure tallies, no mass-death
 * brake. Its whole status is in-memory: whether the loop is running, when it
 * last ran, and the error from that run if there was one.
 *
 *   - GET  /api/deacon/status  — child process state plus deacon-lite's own
 *   - GET  /api/deacon/logs    — always empty; there is no ring buffer left
 *   - POST /api/deacon/patrol  — trigger a patrol cycle on demand
 * The compact CommandDeck `DeaconStatus` widget shows a peek of the same data;
 * this is the full page.
 */

interface DeaconStatusData {
  isRunning: boolean;
  pid: number | null;
  startedAt: string | null;
  deaconLite: {
    running: boolean;
    intervalMs: number;
    lastRunAt: string | null;
    lastRunError: string | null;
  };
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

  // Newest first for the feed.
  const groups = useMemo(
    () => groupByCycle([...(logData?.logs || [])].reverse()),
    [logData],
  );

  const intervalSec = status ? Math.round(status.deaconLite.intervalMs / 1000) : null;

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
          <Stat label="Loop" value={status ? (status.deaconLite.running ? 'Patrolling' : 'Idle') : '—'} />
          <Stat label="Last patrol" value={timeAgo(status?.deaconLite.lastRunAt ?? undefined)} />
          <Stat label="Interval" value={intervalSec != null ? `${intervalSec}s` : '—'} />
        </div>

        {status?.deaconLite.lastRunError && (
          <div className="flex items-center gap-2 mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Last patrol failed: {status.deaconLite.lastRunError}
          </div>
        )}

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
