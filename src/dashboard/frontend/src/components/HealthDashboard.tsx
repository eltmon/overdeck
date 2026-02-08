import { useQuery } from '@tanstack/react-query';
import { AgentHealth } from '../types';
import { Activity, AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react';

async function fetchHealth(): Promise<AgentHealth[]> {
  const res = await fetch('/api/health/agents');
  if (!res.ok) throw new Error('Failed to fetch health');
  return res.json();
}

const STATUS_CONFIG: Record<AgentHealth['status'], { icon: typeof CheckCircle; color: string; bg: string }> = {
  healthy: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-900/30' },
  warning: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  stuck: { icon: Clock, color: 'text-orange-400', bg: 'bg-orange-900/30' },
  dead: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-900/30' },
};

export function HealthDashboard() {
  const { data: health, isLoading, error } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-content-subtle">Loading health data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Error: {(error as Error).message}</div>
      </div>
    );
  }

  if (!health || health.length === 0) {
    return (
      <div className="bg-surface-raised rounded-lg p-8 text-center">
        <Activity className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-content-subtle">No agents to monitor</h3>
        <p className="text-sm text-content-muted mt-2">
          Health data will appear here when agents are running
        </p>
      </div>
    );
  }

  // Summary counts
  const counts = health.reduce(
    (acc, h) => {
      acc[h.status] = (acc[h.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        {(['healthy', 'warning', 'stuck', 'dead'] as const).map((status) => {
          const config = STATUS_CONFIG[status];
          const Icon = config.icon;
          return (
            <div
              key={status}
              className={`${config.bg} rounded-lg p-4 border border-divider`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-8 h-8 ${config.color}`} />
                <div>
                  <div className="text-2xl font-bold text-content">{counts[status] || 0}</div>
                  <div className="text-sm text-content-subtle capitalize">{status}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Agent cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {health.map((agent) => {
          const config = STATUS_CONFIG[agent.status];
          const Icon = config.icon;
          return (
            <div
              key={agent.agentId}
              className={`${config.bg} rounded-lg p-4 border border-divider`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-content">{agent.agentId}</div>
                  <div className={`flex items-center gap-1 text-sm ${config.color} mt-1`}>
                    <Icon className="w-4 h-4" />
                    <span className="capitalize">{agent.status}</span>
                  </div>
                </div>
              </div>

              {agent.reason && (
                <div className="mt-2 text-sm text-content-subtle italic">
                  {agent.reason}
                </div>
              )}

              <div className="mt-4 space-y-2 text-sm">
                {agent.lastPing && (
                  <div className="flex justify-between text-content-subtle">
                    <span>Last ping:</span>
                    <span>{new Date(agent.lastPing).toLocaleTimeString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-content-subtle">
                  <span>Failures:</span>
                  <span className={agent.consecutiveFailures > 0 ? 'text-orange-400' : ''}>
                    {agent.consecutiveFailures}
                  </span>
                </div>
                <div className="flex justify-between text-content-subtle">
                  <span>Kill count:</span>
                  <span className={agent.killCount > 0 ? 'text-red-400' : ''}>
                    {agent.killCount}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
