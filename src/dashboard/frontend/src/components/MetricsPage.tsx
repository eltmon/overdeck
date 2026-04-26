/**
 * Dedicated Metrics Page
 *
 * Full-page metrics view with detailed breakdowns
 */

import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { TldrServiceStatus } from './TldrServiceStatus';

interface MetricsSummary {
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

interface CostMetrics {
  dailyTotal: number;
  topAgents: Array<{ agentId: string; cost: number }>;
  topIssues: Array<{ issueId: string; cost: number }>;
}

async function fetchMetricsSummary(): Promise<MetricsSummary> {
  const res = await fetch('/api/metrics/summary');
  if (!res.ok) throw new Error('Failed to fetch metrics summary');
  return res.json();
}

async function fetchCostMetrics(): Promise<CostMetrics> {
  const res = await fetch('/api/metrics/costs');
  if (!res.ok) throw new Error('Failed to fetch cost metrics');
  return res.json();
}

export function MetricsPage() {
  const { data: summary } = useQuery({
    queryKey: ['metrics-summary'],
    queryFn: fetchMetricsSummary,
    refetchInterval: 30000,
  });

  const { data: costs } = useQuery({
    queryKey: ['metrics-costs'],
    queryFn: fetchCostMetrics,
    refetchInterval: 30000,
  });

  return (
    <div className="p-6 overflow-auto h-full">
      <h1 className="text-3xl font-bold text-foreground mb-6">Metrics Dashboard</h1>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Cost Today */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-3">
              <DollarSign className="w-6 h-6 text-success" />
              <h3 className="text-lg font-semibold text-foreground">Cost Today (UTC)</h3>
            </div>
            <div className="text-3xl font-bold text-foreground mb-2">
              ${summary.today.totalCost.toFixed(2)}
            </div>
            <div className="text-sm text-muted-foreground">Daily total</div>
          </div>

          {/* Active Agents */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-3">
              <TrendingUp className="w-6 h-6 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Active Agents</h3>
            </div>
            <div className="text-3xl font-bold text-foreground mb-2">
              {summary.today.activeCount}
            </div>
            <div className="text-sm text-muted-foreground">
              of {summary.today.agentCount} total
            </div>
          </div>

          {/* Stuck Agents */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="w-6 h-6 text-destructive" />
              <h3 className="text-lg font-semibold text-foreground">Stuck Agents</h3>
            </div>
            <div className="text-3xl font-bold text-foreground mb-2">
              {summary.today.stuckCount}
            </div>
            <div className="text-sm text-muted-foreground">
              {summary.today.warningCount} warnings
            </div>
          </div>

          {/* Handoffs */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-3">
              <ArrowRightLeft className="w-6 h-6 text-signal-review" />
              <h3 className="text-lg font-semibold text-foreground">Handoffs Today</h3>
            </div>
            <div className="text-3xl font-bold text-foreground mb-2">-</div>
            <div className="text-sm text-muted-foreground">Coming soon</div>
          </div>
        </div>
      )}

      {/* Cost Breakdown */}
      {costs && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Top Agents by Cost */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-xl font-semibold text-foreground mb-4">Top Agents by Cost</h3>
            <div className="space-y-3">
              {costs.topAgents.slice(0, 10).map((agent, index) => (
                <div
                  key={agent.agentId}
                  className="flex items-center justify-between p-3 bg-card/50 rounded"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-muted-foreground">#{index + 1}</span>
                    <span className="text-foreground font-mono text-sm">{agent.agentId}</span>
                  </div>
                  <span className="text-success font-semibold">
                    ${agent.cost.toFixed(2)}
                  </span>
                </div>
              ))}
              {costs.topAgents.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No cost data yet</div>
              )}
            </div>
          </div>

          {/* Top Issues by Cost */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-xl font-semibold text-foreground mb-4">Top Issues by Cost</h3>
            <div className="space-y-3">
              {costs.topIssues.slice(0, 10).map((issue, index) => (
                <div
                  key={issue.issueId}
                  className="flex items-center justify-between p-3 bg-card/50 rounded"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-muted-foreground">#{index + 1}</span>
                    <span className="text-foreground font-mono text-sm">{issue.issueId}</span>
                  </div>
                  <span className="text-success font-semibold">
                    ${issue.cost.toFixed(2)}
                  </span>
                </div>
              ))}
              {costs.topIssues.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No cost data yet</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TLDR Code Analysis Status */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-foreground mb-4">Services</h2>
        <TldrServiceStatus />
      </div>

      {/* Placeholder for charts */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-xl font-semibold text-foreground mb-4">Historical Trends</h3>
        <div className="text-center text-muted-foreground py-16">
          <p className="mb-2">Charts coming soon</p>
          <p className="text-sm">Cost over time, handoff success rates, and more</p>
        </div>
      </div>
    </div>
  );
}
