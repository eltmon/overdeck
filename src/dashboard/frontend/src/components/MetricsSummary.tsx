/**
 * Metrics Summary Component
 *
 * Dashboard widgets showing key metrics: cost, agent counts, incidents
 */

import { useQuery } from '@tanstack/react-query';
import { DollarSign, Users, AlertTriangle, TrendingUp, GitBranch, Layers, Activity } from 'lucide-react';

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

interface HandoffStats {
  totalHandoffs: number;
  byTrigger: Record<string, number>;
  byModel: {
    from: Record<string, number>;
    to: Record<string, number>;
  };
  successRate: number;
}

interface SpecialistHandoffStats {
  totalHandoffs: number;
  todayCount: number;
  bySpecialist: Record<string, { sent: number; received: number }>;
  byStatus: Record<string, number>;
  successRate: number;
  queueDepth: number;
}

interface CostStatus {
  migration: {
    completed: boolean;
    state: {
      completed: boolean;
      completedAt: string;
      workspaceCount: number;
      eventCount: number;
    } | null;
  };
  cache: {
    issueCount: number;
    lastEventLine: number;
    lastEventTs: string;
  };
  events: {
    exists: boolean;
    totalEvents: number;
    fileSize: number;
    oldestEvent?: string;
    newestEvent?: string;
  };
}

async function fetchMetricsSummary(): Promise<MetricsSummary> {
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

async function fetchCostStatus(): Promise<CostStatus> {
  const res = await fetch('/api/costs/status');
  if (!res.ok) throw new Error('Failed to fetch cost status');
  return res.json();
}

export function MetricsSummary() {
  const { data: metrics } = useQuery({
    queryKey: ['metrics-summary'],
    queryFn: fetchMetricsSummary,
    refetchInterval: 30000, // Refresh every 30 seconds
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

  const { data: costStatus } = useQuery({
    queryKey: ['cost-status'],
    queryFn: fetchCostStatus,
    refetchInterval: 30000,
  });

  if (!metrics) {
    return null;
  }

  // Count cost escalations from today (from handoff stats)
  const costEscalations = handoffStats
    ? Object.values(handoffStats.byTrigger).reduce((sum, count) => sum + count, 0)
    : 0;

  // Determine cost tracking status
  const getCostTrackingStatus = () => {
    if (!costStatus) return { label: 'Unknown', color: 'gray' };

    // Check if migration is in progress
    if (!costStatus.migration.completed) {
      return { label: 'Migrating', color: 'yellow' };
    }

    // Check if events are stale (no events in 24h)
    if (costStatus.events.newestEvent) {
      const newestEventTime = new Date(costStatus.events.newestEvent).getTime();
      const now = Date.now();
      const hoursSinceLastEvent = (now - newestEventTime) / (1000 * 60 * 60);

      if (hoursSinceLastEvent > 24) {
        return { label: 'Stale', color: 'red' };
      }
    }

    return { label: 'Live', color: 'green' };
  };

  const costStatus_ = getCostTrackingStatus();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
      {/* Cost Today */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            <span className="text-sm text-gray-400">Cost Today</span>
          </div>
          <span
            className={`px-2 py-1 text-xs font-medium rounded ${
              costStatus_.color === 'green'
                ? 'bg-green-900/30 text-green-400 border border-green-700'
                : costStatus_.color === 'yellow'
                ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700'
                : costStatus_.color === 'red'
                ? 'bg-red-900/30 text-red-400 border border-red-700'
                : 'bg-gray-900/30 text-gray-400 border border-gray-700'
            }`}
          >
            {costStatus_.label}
          </span>
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

      {/* Specialist Handoffs */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-cyan-400" />
            <span className="text-sm text-gray-400">Specialist Handoffs</span>
          </div>
        </div>
        <div className="text-2xl font-bold text-white">
          {specialistStats?.todayCount ?? 0}
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {specialistStats
            ? `${(specialistStats.successRate * 100).toFixed(0)}% success rate`
            : 'No data'}
        </div>
      </div>

      {/* Cost Escalations */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-400" />
            <span className="text-sm text-gray-400">Cost Escalations</span>
          </div>
        </div>
        <div className="text-2xl font-bold text-white">{costEscalations}</div>
        <div className="mt-2 text-xs text-gray-500">
          {handoffStats
            ? `${(handoffStats.successRate * 100).toFixed(0)}% success rate`
            : 'No data'}
        </div>
      </div>

      {/* Queue Depth */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-orange-400" />
            <span className="text-sm text-gray-400">Queue Depth</span>
          </div>
        </div>
        <div className="text-2xl font-bold text-white">
          {specialistStats?.queueDepth ?? 0}
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {specialistStats?.queueDepth === 0
            ? 'All clear'
            : `${specialistStats?.queueDepth} pending`}
        </div>
      </div>
    </div>
  );
}
