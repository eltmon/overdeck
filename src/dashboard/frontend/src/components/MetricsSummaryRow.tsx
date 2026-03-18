import { useQuery } from '@tanstack/react-query';
import { DollarSign, Users, AlertTriangle, GitBranch, TrendingUp, Layers } from 'lucide-react';

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
  color?: string;
}

function MetricTile({ icon, label, value, subtext, color = '#92a4c9' }: MetricTileProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-lg border min-w-0"
      style={{ backgroundColor: '#161b26', borderColor: '#232f48' }}
    >
      <div className="shrink-0" style={{ color }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs" style={{ color: '#92a4c9' }}>{label}</div>
        <div className="text-sm font-semibold text-white leading-tight" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>
          {value}
        </div>
        {subtext && (
          <div className="text-[10px] truncate" style={{ color: '#92a4c9' }}>{subtext}</div>
        )}
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

  return (
    <div className="flex gap-3 mb-4 overflow-x-auto scrollbar-hide pb-1">
      <MetricTile
        icon={<DollarSign className="w-4 h-4" />}
        label="Cost Today"
        value={`$${metrics.today.totalCost.toFixed(2)}`}
        color="#4ade80"
      />
      <MetricTile
        icon={<Users className="w-4 h-4" />}
        label="Agents"
        value={`${metrics.today.activeCount} / ${metrics.today.agentCount}`}
        subtext={`${metrics.today.activeCount} active`}
        color="#60a5fa"
      />
      <MetricTile
        icon={<AlertTriangle className="w-4 h-4" />}
        label="Stuck"
        value={metrics.today.stuckCount}
        subtext={`${metrics.today.warningCount} warnings`}
        color={metrics.today.stuckCount > 0 ? '#f87171' : '#92a4c9'}
      />
      <MetricTile
        icon={<GitBranch className="w-4 h-4" />}
        label="Handoffs"
        value={specialistStats?.todayCount ?? 0}
        subtext={specialistStats ? `${(specialistStats.successRate * 100).toFixed(0)}% success` : undefined}
        color="#22d3ee"
      />
      <MetricTile
        icon={<TrendingUp className="w-4 h-4" />}
        label="Escalations"
        value={costEscalations}
        color="#c084fc"
      />
      <MetricTile
        icon={<Layers className="w-4 h-4" />}
        label="Queue Depth"
        value={specialistStats?.queueDepth ?? 0}
        color="#fb923c"
      />
    </div>
  );
}
