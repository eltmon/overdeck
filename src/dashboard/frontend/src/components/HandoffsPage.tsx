import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock } from 'lucide-react';

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const month = date.toLocaleString('default', { month: 'short' });
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${month} ${day}, ${hours}:${minutes}:${seconds}`;
}

interface HandoffEvent {
  timestamp: string;
  agentId: string;
  issueId: string;
  from: { model: string; runtime: string };
  to: { model: string; runtime: string };
  trigger: string;
  reason: string;
  context: {
    costAtHandoff?: number;
    handoffCount?: number;
    stuckMinutes?: number;
  };
  success: boolean;
  errorMessage?: string;
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

async function fetchHandoffs(limit: number = 50): Promise<{ handoffs: HandoffEvent[]; total: number }> {
  const res = await fetch(`/api/handoffs?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch handoffs');
  return res.json();
}

async function fetchHandoffStats(): Promise<HandoffStats> {
  const res = await fetch('/api/handoffs/stats');
  if (!res.ok) throw new Error('Failed to fetch handoff stats');
  return res.json();
}

const MODEL_COLORS = {
  opus: 'text-purple-400 bg-purple-900/20 border-purple-500/30',
  sonnet: 'text-blue-400 bg-blue-900/20 border-blue-500/30',
  haiku: 'text-green-400 bg-green-900/20 border-green-500/30',
};

const TRIGGER_LABELS: Record<string, string> = {
  stuck_escalation: 'Stuck Escalation',
  planning_complete: 'Planning Complete',
  test_failure: 'Test Failure',
  task_complete: 'Task Complete',
  manual: 'Manual',
};

const TRIGGER_COLORS: Record<string, string> = {
  stuck_escalation: 'text-red-400',
  planning_complete: 'text-green-400',
  test_failure: 'text-orange-400',
  task_complete: 'text-blue-400',
  manual: 'text-gray-400',
};

export function HandoffsPage() {
  const { data: handoffsData, isLoading: isLoadingHandoffs } = useQuery({
    queryKey: ['handoffs'],
    queryFn: () => fetchHandoffs(50),
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ['handoff-stats'],
    queryFn: fetchHandoffStats,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoadingHandoffs || isLoadingStats) {
    return (
      <div className="p-6">
        <div className="text-gray-400">Loading handoff data...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Model Handoffs</h2>
        <p className="text-gray-400">
          History of automatic and manual model handoffs across agents
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Total Handoffs</div>
            <div className="text-2xl font-bold text-white">{stats.totalHandoffs}</div>
          </div>
          <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Success Rate</div>
            <div className="text-2xl font-bold text-green-400">
              {(stats.successRate * 100).toFixed(0)}%
            </div>
          </div>
          <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Most Common Trigger</div>
            <div className="text-sm font-medium text-white">
              {Object.entries(stats.byTrigger).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'}
            </div>
            <div className="text-xs text-gray-500">
              {Object.entries(stats.byTrigger).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} times
            </div>
          </div>
          <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Most Popular Target</div>
            <div className="text-sm font-medium text-white">
              {Object.entries(stats.byModel.to).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'}
            </div>
            <div className="text-xs text-gray-500">
              {Object.entries(stats.byModel.to).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} handoffs
            </div>
          </div>
        </div>
      )}

      {/* Handoff History Table */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">Recent Handoffs</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-750 text-left text-sm text-gray-400">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Transition</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {handoffsData && handoffsData.handoffs.length > 0 ? (
                handoffsData.handoffs.map((handoff, index) => (
                  <tr
                    key={`${handoff.timestamp}-${index}`}
                    className="border-t border-gray-700 hover:bg-gray-750"
                  >
                    <td className="px-4 py-3 text-gray-400">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTimestamp(handoff.timestamp)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{handoff.agentId}</div>
                      <div className="text-xs text-gray-500">{handoff.issueId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 text-xs rounded border ${
                            MODEL_COLORS[handoff.from.model as keyof typeof MODEL_COLORS] ||
                            'text-gray-400 bg-gray-700'
                          }`}
                        >
                          {handoff.from.model}
                        </span>
                        <ArrowRight className="w-3 h-3 text-gray-500" />
                        <span
                          className={`px-2 py-0.5 text-xs rounded border ${
                            MODEL_COLORS[handoff.to.model as keyof typeof MODEL_COLORS] ||
                            'text-gray-400 bg-gray-700'
                          }`}
                        >
                          {handoff.to.model}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs ${
                          TRIGGER_COLORS[handoff.trigger] || 'text-gray-400'
                        }`}
                      >
                        {TRIGGER_LABELS[handoff.trigger] || handoff.trigger}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300 max-w-xs truncate">
                      {handoff.reason}
                    </td>
                    <td className="px-4 py-3 text-emerald-400">
                      {handoff.context.costAtHandoff !== undefined
                        ? `$${handoff.context.costAtHandoff.toFixed(4)}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {handoff.success ? (
                        <span className="text-green-400 text-xs">✓ Success</span>
                      ) : (
                        <span className="text-red-400 text-xs" title={handoff.errorMessage}>
                          ✗ Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No handoffs recorded yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
