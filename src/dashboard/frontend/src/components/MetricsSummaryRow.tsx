import { useQuery } from '@tanstack/react-query';
import { DollarSign, Users, AlertTriangle } from 'lucide-react';

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

async function fetchMetricsSummary(): Promise<MetricsSummaryData> {
  const res = await fetch('/api/metrics/summary');
  if (!res.ok) throw new Error('Failed to fetch metrics summary');
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
    <div className="flex flex-1 items-center justify-center gap-2 px-2 py-2 whitespace-nowrap border-r border-border last:border-r-0">
      <div className={`shrink-0 ${valueClass} opacity-40`}>
        {icon}
      </div>
      <div className="flex flex-col">
        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground leading-none mb-0.5">
          {label}
        </span>
        <div className="flex items-baseline gap-1">
          {pulse && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" style={{ color: 'var(--primary)' }} />}
          <span className={`text-base font-semibold tabular-nums leading-none font-display ${valueClass}`}>
            {value}
          </span>
          {subtext && (
            <span className="text-[10px] text-muted-foreground">{subtext}</span>
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

  if (!metrics) return null;

  const stuckColor = metrics.today.stuckCount > 0 ? 'text-destructive' : 'text-muted-foreground';

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
    </div>
  );
}
