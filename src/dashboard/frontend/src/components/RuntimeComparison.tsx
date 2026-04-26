/**
 * Runtime Comparison Component
 *
 * Shows metrics comparison across different AI runtimes.
 */

import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  TrendingUp,
  Clock,
  DollarSign,
  CheckCircle,
  Cpu
} from 'lucide-react';

interface CapabilityStats {
  tasks: number;
  successfulTasks: number;
  successRate: number;
  avgDurationMinutes: number;
  totalCost: number;
  avgCost: number;
}

interface DailyStats {
  date: string;
  tasks: number;
  successfulTasks: number;
  cost: number;
  successRate: number;
  tokenCount: number;
}

interface RuntimeMetrics {
  runtime: string;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  partialTasks: number;
  successRate: number;
  avgDurationMinutes: number;
  avgCost: number;
  totalCost: number;
  totalTokens: number;
  byCapability: Record<string, CapabilityStats>;
  byModel: Record<string, {
    tasks: number;
    successRate: number;
    avgCost: number;
    totalCost: number;
  }>;
  dailyStats: DailyStats[];
  lastUpdated: string;
}

interface MetricsResponse {
  runtimes: Record<string, RuntimeMetrics>;
  aggregated: {
    totalTasks: number;
    totalCost: number;
    totalTokens: number;
    avgSuccessRate: number;
    avgDuration: number;
  };
}

async function fetchRuntimeMetrics(): Promise<MetricsResponse> {
  const response = await fetch('/api/metrics/runtimes');
  if (!response.ok) {
    throw new Error('Failed to fetch runtime metrics');
  }
  return response.json();
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 1) {
    return `${Math.round(minutes * 60)}s`;
  }
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function getSuccessColor(rate: number): string {
  if (rate >= 0.9) return 'text-success';
  if (rate >= 0.7) return 'text-warning';
  if (rate >= 0.5) return 'text-warning';
  return 'text-destructive';
}

function getRuntimeIcon(runtime: string): string {
  const icons: Record<string, string> = {
    'claude': '🤖',
    'codex': '🧠',
    'cursor': '📝',
    'copilot': '✈️',
    'aider': '🔧',
    'continue': '➡️',
  };
  return icons[runtime.toLowerCase()] || '⚙️';
}

export function RuntimeComparison() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['runtimeMetrics'],
    queryFn: fetchRuntimeMetrics,
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-popover rounded w-1/4"></div>
          <div className="h-64 bg-popover rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="badge-bg-destructive border border-destructive/30 rounded-lg p-4">
          <p className="text-destructive">Failed to load runtime metrics</p>
        </div>
      </div>
    );
  }

  const runtimes = data?.runtimes ? Object.values(data.runtimes) : [];
  const aggregated = data?.aggregated;

  if (runtimes.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Runtime Comparison
        </h2>
        <div className="bg-card rounded-lg p-8 text-center">
          <Cpu className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No runtime metrics recorded yet.</p>
          <p className="text-muted-foreground text-sm mt-2">
            Metrics will appear here as tasks are completed by different runtimes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Runtime Comparison
        </h2>
        {aggregated && (
          <div className="text-sm text-muted-foreground">
            {aggregated.totalTasks} total tasks • {formatCost(aggregated.totalCost)} total cost
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {aggregated && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <CheckCircle className="w-4 h-4" />
              Total Tasks
            </div>
            <div className="text-2xl font-bold">{aggregated.totalTasks}</div>
          </div>
          <div className="bg-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingUp className="w-4 h-4" />
              Avg Success Rate
            </div>
            <div className={`text-2xl font-bold ${getSuccessColor(aggregated.avgSuccessRate)}`}>
              {formatPercent(aggregated.avgSuccessRate)}
            </div>
          </div>
          <div className="bg-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Clock className="w-4 h-4" />
              Avg Duration
            </div>
            <div className="text-2xl font-bold">{formatDuration(aggregated.avgDuration)}</div>
          </div>
          <div className="bg-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <DollarSign className="w-4 h-4" />
              Total Cost
            </div>
            <div className="text-2xl font-bold text-success">{formatCost(aggregated.totalCost)}</div>
          </div>
        </div>
      )}

      {/* Runtime Comparison Table */}
      <div className="bg-card rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-4 text-muted-foreground font-medium">Runtime</th>
              <th className="text-right p-4 text-muted-foreground font-medium">Tasks</th>
              <th className="text-right p-4 text-muted-foreground font-medium">Success Rate</th>
              <th className="text-right p-4 text-muted-foreground font-medium">Avg Duration</th>
              <th className="text-right p-4 text-muted-foreground font-medium">Avg Cost</th>
              <th className="text-right p-4 text-muted-foreground font-medium">Total Cost</th>
              <th className="text-right p-4 text-muted-foreground font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {runtimes.map((runtime) => (
              <tr
                key={runtime.runtime}
                className="border-b border-border/50 hover:bg-popover/30 transition-colors"
              >
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getRuntimeIcon(runtime.runtime)}</span>
                    <span className="font-medium capitalize">{runtime.runtime}</span>
                  </div>
                </td>
                <td className="text-right p-4">
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-success" title="Successful">
                      {runtime.successfulTasks}
                    </span>
                    <span className="text-muted-foreground">/</span>
                    <span>{runtime.totalTasks}</span>
                    {runtime.failedTasks > 0 && (
                      <span className="text-destructive text-sm" title="Failed">
                        ({runtime.failedTasks} failed)
                      </span>
                    )}
                  </div>
                </td>
                <td className="text-right p-4">
                  <span className={getSuccessColor(runtime.successRate)}>
                    {formatPercent(runtime.successRate)}
                  </span>
                </td>
                <td className="text-right p-4 text-foreground">
                  {formatDuration(runtime.avgDurationMinutes)}
                </td>
                <td className="text-right p-4 text-foreground">
                  {formatCost(runtime.avgCost)}
                </td>
                <td className="text-right p-4 font-medium text-success">
                  {formatCost(runtime.totalCost)}
                </td>
                <td className="text-right p-4 text-foreground">
                  {formatTokens(runtime.totalTokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* By Capability Breakdown */}
      <div className="grid grid-cols-2 gap-6">
        {runtimes.map((runtime) => (
          <div key={runtime.runtime} className="bg-card rounded-lg p-4">
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <span>{getRuntimeIcon(runtime.runtime)}</span>
              <span className="capitalize">{runtime.runtime}</span>
              <span className="text-muted-foreground text-sm">by Capability</span>
            </h3>

            {Object.keys(runtime.byCapability).length === 0 ? (
              <p className="text-muted-foreground text-sm">No capability data</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(runtime.byCapability).map(([capability, stats]) => (
                  <div
                    key={capability}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="capitalize text-foreground">{capability}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">{stats.tasks} tasks</span>
                      <span className={getSuccessColor(stats.successRate)}>
                        {formatPercent(stats.successRate)}
                      </span>
                      <span className="text-success w-16 text-right">
                        {formatCost(stats.totalCost)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* By Model Breakdown */}
      <div className="bg-card rounded-lg p-4">
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <Cpu className="w-4 h-4" />
          By Model
        </h3>

        <div className="grid grid-cols-3 gap-4">
          {runtimes.map((runtime) => (
            <div key={runtime.runtime} className="space-y-2">
              <h4 className="text-sm text-muted-foreground capitalize">{runtime.runtime}</h4>
              {Object.keys(runtime.byModel).length === 0 ? (
                <p className="text-muted-foreground text-xs">No model data</p>
              ) : (
                Object.entries(runtime.byModel).map(([model, stats]) => (
                  <div
                    key={model}
                    className="bg-popover/50 rounded p-2 text-sm"
                  >
                    <div className="font-medium text-foreground truncate" title={model}>
                      {model}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                      <span>{stats.tasks} tasks</span>
                      <span className={getSuccessColor(stats.successRate)}>
                        {formatPercent(stats.successRate)}
                      </span>
                      <span className="text-success">{formatCost(stats.totalCost)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Daily Stats Chart (simplified text version) */}
      {runtimes.some(r => r.dailyStats.length > 0) && (
        <div className="bg-card rounded-lg p-4">
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Daily Activity (Last 30 Days)
          </h3>

          <div className="overflow-x-auto">
            <div className="flex gap-1 min-w-max">
              {/* Aggregate daily stats across all runtimes */}
              {(() => {
                const allDates = new Set<string>();
                runtimes.forEach(r => r.dailyStats.forEach(d => allDates.add(d.date)));
                const sortedDates = Array.from(allDates).sort();

                return sortedDates.slice(-30).map(date => {
                  const dayTasks = runtimes.reduce((sum, r) => {
                    const dayData = r.dailyStats.find(d => d.date === date);
                    return sum + (dayData?.tasks || 0);
                  }, 0);

                  const dayCost = runtimes.reduce((sum, r) => {
                    const dayData = r.dailyStats.find(d => d.date === date);
                    return sum + (dayData?.cost || 0);
                  }, 0);

                  const maxTasks = Math.max(...Array.from(allDates).map(d =>
                    runtimes.reduce((sum, r) => {
                      const dayData = r.dailyStats.find(ds => ds.date === d);
                      return sum + (dayData?.tasks || 0);
                    }, 0)
                  ), 1);

                  const height = Math.max((dayTasks / maxTasks) * 60, 4);

                  return (
                    <div
                      key={date}
                      className="flex flex-col items-center group"
                      title={`${date}: ${dayTasks} tasks, ${formatCost(dayCost)}`}
                    >
                      <div className="h-16 flex items-end">
                        <div
                          className="w-3 bg-primary rounded-t transition-all group-hover:bg-primary/80"
                          style={{ height: `${height}px` }}
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1 rotate-45 origin-left w-8">
                        {date.slice(5)}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RuntimeComparison;
