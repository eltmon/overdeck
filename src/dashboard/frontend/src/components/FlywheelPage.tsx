/**
 * FlywheelPage — /flywheel route (PAN-709, bead 8fc)
 *
 * Metrics panel + flywheel changes tab on a single page.
 * NO cost/spend/dollar display anywhere — per the PRD cost-out decision.
 */

import { useQuery } from '@tanstack/react-query';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { FlywheelChangesTab } from './FlywheelChangesTab';

// ============================================================================
// Types
// ============================================================================

interface FlywheelMetrics {
  retrosProcessed: number;
  retrosNoOp: number;
  topPatterns: Array<{ pattern: string; issueCount: number }>;
}

interface DaemonStatus {
  isRunning: boolean;
  lastSynthesisAt: number | null;
  lastFullCycleAt: number | null;
  lockHeld: boolean;
  config: {
    autonomous: boolean;
    quiet_hours: string;
    trigger_interval_minutes: number;
  };
}

// ============================================================================
// API helpers
// ============================================================================

async function fetchFlywheelMetrics(): Promise<FlywheelMetrics> {
  const res = await fetch('/api/flywheel/metrics');
  if (!res.ok) return { retrosProcessed: 0, retrosNoOp: 0, topPatterns: [] };
  return res.json();
}

async function fetchDaemonStatus(): Promise<DaemonStatus> {
  const res = await fetch('/api/flywheel/daemon/status');
  if (!res.ok) throw new Error('Failed to load daemon status');
  return res.json();
}

// ============================================================================
// MetricTile
// ============================================================================

interface MetricTileProps {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ReactNode;
}

function MetricTile({ label, value, sub, icon }: MetricTileProps) {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// ============================================================================
// FlywheelPage
// ============================================================================

export function FlywheelPage() {
  const metricsQuery = useQuery({
    queryKey: ['flywheel-metrics'],
    queryFn: fetchFlywheelMetrics,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const daemonQuery = useQuery({
    queryKey: ['flywheel-daemon-status'],
    queryFn: fetchDaemonStatus,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const metrics = metricsQuery.data;
  const daemon = daemonQuery.data;

  const lastSynthesisLabel = daemon?.lastSynthesisAt
    ? new Date(daemon.lastSynthesisAt).toLocaleTimeString()
    : 'Never';

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto p-6">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <RefreshCw className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground font-display">
              Flywheel
            </h1>
            {daemon && (
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                daemon.isRunning
                  ? 'bg-green-500/10 text-green-600'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {daemon.isRunning ? 'Running' : 'Stopped'}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Panopticon self-improvement metrics. Retros processed through the retro → synthesis → PR cycle.
            {daemon && ` Last synthesis: ${lastSynthesisLabel}.`}
          </p>
        </header>

        {/* Metrics panel */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          <MetricTile
            label="Retros Processed"
            value={metrics?.retrosProcessed ?? '—'}
            icon={<CheckCircle className="w-4 h-4" />}
          />
          <MetricTile
            label="Retros No-Op"
            value={metrics?.retrosNoOp ?? '—'}
            sub="boring = healthy"
            icon={<XCircle className="w-4 h-4" />}
          />
          <MetricTile
            label="Top Pattern"
            value={metrics?.topPatterns[0]?.pattern ?? '—'}
            sub={metrics?.topPatterns[0] ? `${metrics.topPatterns[0].issueCount} issues` : undefined}
            icon={<RefreshCw className="w-4 h-4" />}
          />
        </div>

        {/* Top patterns */}
        {metrics?.topPatterns && metrics.topPatterns.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-foreground mb-3">Top Friction Patterns</h2>
            <ol className="space-y-2">
              {metrics.topPatterns.slice(0, 5).map((p, i) => (
                <li key={i} className="flex items-baseline gap-3 text-sm">
                  <span className="text-muted-foreground w-4 text-right">{i + 1}.</span>
                  <code className="text-foreground">{p.pattern}</code>
                  <span className="text-muted-foreground ml-auto">
                    {p.issueCount} issue{p.issueCount !== 1 ? 's' : ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Flywheel changes awaiting merge */}
        <h2 className="text-sm font-semibold text-foreground mb-3">Flywheel Changes Awaiting Merge</h2>
        <FlywheelChangesTab />
      </div>
    </div>
  );
}
