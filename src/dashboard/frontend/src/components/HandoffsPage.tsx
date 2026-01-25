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

interface SpecialistHandoff {
  id: string;
  timestamp: string;
  issueId: string;
  fromSpecialist: string;
  toSpecialist: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  completedAt?: string;
  result?: 'success' | 'failure';
  context?: {
    workspace?: string;
    branch?: string;
    prUrl?: string;
  };
}

interface SpecialistHandoffStats {
  totalHandoffs: number;
  todayCount: number;
  bySpecialist: Record<string, { sent: number; received: number }>;
  byStatus: Record<string, number>;
  successRate: number;
  queueDepth: number;
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

async function fetchSpecialistHandoffs(
  limit: number = 50
): Promise<{ handoffs: SpecialistHandoff[]; total: number }> {
  const res = await fetch(`/api/specialist-handoffs?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch specialist handoffs');
  return res.json();
}

async function fetchSpecialistHandoffStats(): Promise<SpecialistHandoffStats> {
  const res = await fetch('/api/specialist-handoffs/stats');
  if (!res.ok) throw new Error('Failed to fetch specialist handoff stats');
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

const SPECIALIST_COLORS = {
  'review-agent': 'text-purple-400 bg-purple-900/20 border-purple-500/30',
  'test-agent': 'text-green-400 bg-green-900/20 border-green-500/30',
  'merge-agent': 'text-blue-400 bg-blue-900/20 border-blue-500/30',
  'issue-agent': 'text-cyan-400 bg-cyan-900/20 border-cyan-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'text-yellow-400',
  processing: 'text-blue-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  normal: 'text-blue-400',
  low: 'text-gray-400',
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

  const { data: specialistHandoffsData, isLoading: isLoadingSpecialistHandoffs } = useQuery({
    queryKey: ['specialist-handoffs'],
    queryFn: () => fetchSpecialistHandoffs(50),
    refetchInterval: 10000,
  });

  const { data: specialistStats, isLoading: isLoadingSpecialistStats } = useQuery({
    queryKey: ['specialist-handoff-stats'],
    queryFn: fetchSpecialistHandoffStats,
    refetchInterval: 30000,
  });

  if (isLoadingHandoffs || isLoadingStats || isLoadingSpecialistHandoffs || isLoadingSpecialistStats) {
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

      {/* Specialist Handoffs Section */}
      <div className="mt-12">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">Specialist Handoffs</h2>
          <p className="text-gray-400">
            Queue-based work handoffs between specialist agents (review, test, merge)
          </p>
        </div>

        {/* Specialist Stats Cards */}
        {specialistStats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
              <div className="text-sm text-gray-400 mb-1">Today's Handoffs</div>
              <div className="text-2xl font-bold text-white">{specialistStats.todayCount}</div>
            </div>
            <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
              <div className="text-sm text-gray-400 mb-1">Queue Depth</div>
              <div className="text-2xl font-bold text-orange-400">
                {specialistStats.queueDepth}
              </div>
            </div>
            <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
              <div className="text-sm text-gray-400 mb-1">Success Rate</div>
              <div className="text-2xl font-bold text-green-400">
                {(specialistStats.successRate * 100).toFixed(0)}%
              </div>
            </div>
            <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
              <div className="text-sm text-gray-400 mb-1">Most Active</div>
              <div className="text-sm font-medium text-white">
                {Object.entries(specialistStats.bySpecialist)
                  .map(([name, counts]) => ({ name, total: counts.sent + counts.received }))
                  .sort((a, b) => b.total - a.total)[0]?.name || 'N/A'}
              </div>
            </div>
          </div>
        )}

        {/* Specialist Handoffs Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden mt-6">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-lg font-semibold text-white">Recent Specialist Handoffs</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-750 text-left text-sm text-gray-400">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Issue</th>
                  <th className="px-4 py-3">Transition</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Workspace</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {specialistHandoffsData && specialistHandoffsData.handoffs.length > 0 ? (
                  specialistHandoffsData.handoffs.map((handoff) => (
                    <tr key={handoff.id} className="border-t border-gray-700 hover:bg-gray-750">
                      <td className="px-4 py-3 text-gray-400">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTimestamp(handoff.timestamp)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{handoff.issueId}</div>
                        {handoff.context?.branch && (
                          <div className="text-xs text-gray-500">{handoff.context.branch}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-xs rounded border ${
                              SPECIALIST_COLORS[
                                handoff.fromSpecialist as keyof typeof SPECIALIST_COLORS
                              ] || 'text-gray-400 bg-gray-700'
                            }`}
                          >
                            {handoff.fromSpecialist}
                          </span>
                          <ArrowRight className="w-3 h-3 text-gray-500" />
                          <span
                            className={`px-2 py-0.5 text-xs rounded border ${
                              SPECIALIST_COLORS[
                                handoff.toSpecialist as keyof typeof SPECIALIST_COLORS
                              ] || 'text-gray-400 bg-gray-700'
                            }`}
                          >
                            {handoff.toSpecialist}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${PRIORITY_COLORS[handoff.priority]}`}>
                          {handoff.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${STATUS_COLORS[handoff.status]}`}>
                          {handoff.status}
                        </span>
                        {handoff.result && (
                          <span className="ml-2 text-xs text-gray-500">
                            ({handoff.result})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {handoff.context?.workspace || '-'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No specialist handoffs recorded yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
