/**
 * Metrics Summary Component
 *
 * Dashboard widgets showing key metrics: cost, agent counts, incidents
 */

import { useQuery } from '@tanstack/react-query';
import { DollarSign, Users, AlertTriangle, TrendingUp } from 'lucide-react';

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

async function fetchMetricsSummary(): Promise<MetricsSummary> {
  const res = await fetch('/api/metrics/summary');
  if (!res.ok) throw new Error('Failed to fetch metrics summary');
  return res.json();
}

export function MetricsSummary() {
  const { data: metrics } = useQuery({
    queryKey: ['metrics-summary'],
    queryFn: fetchMetricsSummary,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (!metrics) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Cost Today */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            <span className="text-sm text-gray-400">Cost Today</span>
          </div>
        </div>
        <div className="text-2xl font-bold text-white">
          ${metrics.today.totalCost.toFixed(2)}
        </div>
        {metrics.topSpenders.agents.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            Top: {metrics.topSpenders.agents[0].agentId} ($
            {metrics.topSpenders.agents[0].cost.toFixed(2)})
          </div>
        )}
      </div>

      {/* Active Agents */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400" />
            <span className="text-sm text-gray-400">Agents</span>
          </div>
        </div>
        <div className="text-2xl font-bold text-white">
          {metrics.today.activeCount} / {metrics.today.agentCount}
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {metrics.today.activeCount} active, {metrics.today.agentCount - metrics.today.activeCount}{' '}
          idle
        </div>
      </div>

      {/* Stuck Agents */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-sm text-gray-400">Stuck Agents</span>
          </div>
        </div>
        <div className="text-2xl font-bold text-white">{metrics.today.stuckCount}</div>
        <div className="mt-2 text-xs text-gray-500">
          {metrics.today.warningCount} warnings
        </div>
      </div>

      {/* Handoff Success */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-400" />
            <span className="text-sm text-gray-400">Handoffs Today</span>
          </div>
        </div>
        <div className="text-2xl font-bold text-white">-</div>
        <div className="mt-2 text-xs text-gray-500">Coming soon</div>
      </div>
    </div>
  );
}
