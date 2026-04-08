import { useQuery } from '@tanstack/react-query';
import { DollarSign, Users, AlertTriangle, ArrowRightLeft, TrendingUp, Layers } from 'lucide-react';

interface MetricsSummaryData {
  today: {
    totalCost: number;
    agentCount: number;
    activeCount: number;
    stuckCount: number;
    warningCount: number;
  };
  topSpenders: {
    agents: Array<{ agentId: string; cost: number }>;
    issues: Array<{ issueId: string; cost: number }>;
  };
}

interface HandoffStats {
  totalHandoffs: number;
  byTrigger: Record<string, number>;
  successRate: number;
}

interface SpecialistHandoffStats {
  totalHandoffs: number;
  todayCount: number;
  successRate: number;
  queueDepth: number;
}

async function fetchMetricsSummary(): Promise<MetricsSummaryData> {
  const res = await fetch('/api/metrics/summary');
  if (!res.ok) throw new Error('Failed to fetch metrics summary');
  return res.json();
}

async function fetchHandoffStats(): Promise<HandoffStats> {
  const res = await fetch('/api/handoffs/stats');
  if (!res.ok) throw new Error('Failed to fetch handoff stats');
  return res.json();
}

async function fetchSpecialistHandoffStats(): Promise<SpecialistHandoffStats> {
  const res = await fetch('/api/specialist-handoffs/stats');
  if (!res.ok) throw new Error('Failed to fetch specialist handoff stats');
  return res.json();
}

interface MetricTileProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtext?: string;
  valueClass?: string;
  pulse?: boolean;
}

function MetricTile({ icon, label, value, subtext, valueClass = 'text-foreground', pulse }: MetricTileProps) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2.5 px-3 py-3 whitespace-nowrap border-r border-border last:border-r-0">
      <div className={`shrink-0 ${valueClass} opacity-40`}>
        {icon}
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground leading-none mb-1">
          {label}
        </span>
        <div className="flex items-baseline gap-1.5">
          {pulse && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" style={{ color: 'var(--primary)' }} />}
          <span className={`text-lg font-semibold tabular-nums leading-none font-display ${valueClass}`}>
            {value}
          </span>
          {subtext && (
            <span className="text-[11px] text-muted-foreground">{subtext}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function MetricsSummaryRow() {
  const { data: metrics } = useQuery({
    queryKey: ['metrics-summary'],
    queryFn: fetchMetricsSummary,
    refetchInterval: 30000,
  });

  const { data: handoffStats } = useQuery({
    queryKey: ['handoff-stats'],
    queryFn: fetchHandoffStats,
    refetchInterval: 30000,
  });

  const { data: specialistStats } = useQuery({
    queryKey: ['specialist-handoff-stats'],
    queryFn: fetchSpecialistHandoffStats,
    refetchInterval: 30000,
  });

  if (!metrics) return null;

  const costEscalations = handoffStats
    ? Object.values(handoffStats.byTrigger).reduce((sum, count) => sum + count, 0)
    : 0;

  const stuckColor = metrics.today.stuckCount > 0 ? 'text-destructive' : 'text-muted-foreground';
  const escalationColor = costEscalations > 0 ? 'text-signal-review' : 'text-muted-foreground';
  const queueColor = (specialistStats?.queueDepth ?? 0) > 10 ? 'text-warning' : 'text-muted-foreground';

  return (
    <div className="flex items-stretch mb-4 rounded-xl border border-border bg-card">
      <MetricTile
        icon={<DollarSign className="w-4 h-4" />}
        label="Cost Today"
        value={`$${metrics.today.totalCost.toFixed(2)}`}
        valueClass="text-success"
      />
      <MetricTile
        icon={<Users className="w-4 h-4" />}
        label="Agents"
        value={`${metrics.today.activeCount} / ${metrics.today.agentCount}`}
        subtext="active"
        valueClass="text-primary"
        pulse={metrics.today.activeCount > 0}
      />
      <MetricTile
        icon={<AlertTriangle className="w-4 h-4" />}
        label="Stuck"
        value={metrics.today.stuckCount}
        subtext={metrics.today.warningCount > 0 ? `${metrics.today.warningCount} warn` : undefined}
        valueClass={stuckColor}
      />
      <MetricTile
        icon={<ArrowRightLeft className="w-4 h-4" />}
        label="Handoffs"
        value={specialistStats?.todayCount ?? 0}
        subtext={specialistStats ? `${(specialistStats.successRate * 100).toFixed(0)}%` : undefined}
        valueClass="text-signal-cost"
      />
      <MetricTile
        icon={<TrendingUp className="w-4 h-4" />}
        label="Escalations"
        value={costEscalations}
        valueClass={escalationColor}
      />
      <MetricTile
        icon={<Layers className="w-4 h-4" />}
        label="Queue"
        value={specialistStats?.queueDepth ?? 0}
        valueClass={queueColor}
      />
    </div>
  );
}
