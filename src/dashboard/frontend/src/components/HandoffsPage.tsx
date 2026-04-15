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
  opus: 'text-signal-review badge-bg-secondary border-signal-review/30',
  sonnet: 'text-primary badge-bg-primary border-primary/30',
  haiku: 'text-success badge-bg-success border-success/30',
};

const TRIGGER_LABELS: Record<string, string> = {
  stuck_escalation: 'Stuck Escalation',
  test_failure: 'Test Failure',
  task_complete: 'Task Complete',
  manual: 'Manual',
};

const TRIGGER_COLORS: Record<string, string> = {
  stuck_escalation: 'text-destructive',
  test_failure: 'text-warning',
  task_complete: 'text-primary',
  manual: 'text-content-subtle',
};

const SPECIALIST_COLORS = {
  'review-agent': 'text-signal-review badge-bg-secondary border-signal-review/30',
  'test-agent': 'text-success badge-bg-success border-success/30',
  'merge-agent': 'text-primary badge-bg-primary border-primary/30',
  'issue-agent': 'text-cyan-400 bg-cyan-900/20 border-cyan-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'text-warning',
  processing: 'text-primary',
  completed: 'text-success',
  failed: 'text-destructive',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-destructive',
  high: 'text-warning',
  normal: 'text-primary',
  low: 'text-content-subtle',
};

export function HandoffsPage() {
  const { data: handoffsData, isLoading: isLoadingHandoffs } = useQuery({
    queryKey: ['handoffs'],
    queryFn: () => fetchHandoffs(50),
    refetchInterval: 30000, // Refresh every 10 seconds
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ['handoff-stats'],
    queryFn: fetchHandoffStats,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: specialistHandoffsData, isLoading: isLoadingSpecialistHandoffs } = useQuery({
    queryKey: ['specialist-handoffs'],
    queryFn: () => fetchSpecialistHandoffs(50),
    refetchInterval: 30000,
  });

  const { data: specialistStats, isLoading: isLoadingSpecialistStats } = useQuery({
    queryKey: ['specialist-handoff-stats'],
    queryFn: fetchSpecialistHandoffStats,
    refetchInterval: 30000,
  });

  if (isLoadingHandoffs || isLoadingStats || isLoadingSpecialistHandoffs || isLoadingSpecialistStats) {
    return (
      <div className="p-6">
        <div className="text-content-subtle">Loading handoff data...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-content mb-2">Model Handoffs</h2>
        <p className="text-content-subtle">
          History of automatic and manual model handoffs across agents
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 bg-surface-raised rounded-lg border border-divider">
            <div className="text-sm text-content-subtle mb-1">Total Handoffs</div>
            <div className="text-2xl font-bold text-content">{stats.totalHandoffs}</div>
          </div>
          <div className="p-4 bg-surface-raised rounded-lg border border-divider">
            <div className="text-sm text-content-subtle mb-1">Success Rate</div>
            <div className="text-2xl font-bold text-success">
              {(stats.successRate * 100).toFixed(0)}%
            </div>
          </div>
          <div className="p-4 bg-surface-raised rounded-lg border border-divider">
            <div className="text-sm text-content-subtle mb-1">Most Common Trigger</div>
            <div className="text-sm font-medium text-content">
              {Object.entries(stats.byTrigger).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'}
            </div>
            <div className="text-xs text-content-muted">
              {Object.entries(stats.byTrigger).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} times
            </div>
          </div>
          <div className="p-4 bg-surface-raised rounded-lg border border-divider">
            <div className="text-sm text-content-subtle mb-1">Most Popular Target</div>
            <div className="text-sm font-medium text-content">
              {Object.entries(stats.byModel.to).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'}
            </div>
            <div className="text-xs text-content-muted">
              {Object.entries(stats.byModel.to).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} handoffs
            </div>
          </div>
        </div>
      )}

      {/* Handoff History Table */}
      <div className="bg-surface-raised rounded-lg border border-divider overflow-hidden">
        <div className="p-4 border-b border-divider">
          <h3 className="text-lg font-semibold text-content">Recent Handoffs</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-emphasis text-left text-sm text-content-subtle">
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
                    className="border-t border-divider hover:bg-surface-emphasis"
                  >
                    <td className="px-4 py-3 text-content-subtle">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTimestamp(handoff.timestamp)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-content">{handoff.agentId}</div>
                      <div className="text-xs text-content-muted">{handoff.issueId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 text-xs rounded border ${
                            MODEL_COLORS[handoff.from.model as keyof typeof MODEL_COLORS] ||
                            'text-content-subtle bg-surface-overlay'
                          }`}
                        >
                          {handoff.from.model}
                        </span>
                        <ArrowRight className="w-3 h-3 text-content-muted" />
                        <span
                          className={`px-2 py-0.5 text-xs rounded border ${
                            MODEL_COLORS[handoff.to.model as keyof typeof MODEL_COLORS] ||
                            'text-content-subtle bg-surface-overlay'
                          }`}
                        >
                          {handoff.to.model}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs ${
                          TRIGGER_COLORS[handoff.trigger] || 'text-content-subtle'
                        }`}
                      >
                        {TRIGGER_LABELS[handoff.trigger] || handoff.trigger}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-content-body max-w-xs truncate">
                      {handoff.reason}
                    </td>
                    <td className="px-4 py-3 text-emerald-400">
                      {handoff.context.costAtHandoff !== undefined
                        ? `$${handoff.context.costAtHandoff.toFixed(4)}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {handoff.success ? (
                        <span className="text-success text-xs">✓ Success</span>
                      ) : (
                        <span className="text-destructive text-xs" title={handoff.errorMessage}>
                          ✗ Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-content-muted">
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
          <h2 className="text-2xl font-bold text-content mb-2">Specialist Handoffs</h2>
          <p className="text-content-subtle">
            Work handoffs between specialist agents (review, test, merge)
          </p>
        </div>

        {/* Specialist Stats Cards */}
        {specialistStats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-surface-raised rounded-lg border border-divider">
              <div className="text-sm text-content-subtle mb-1">Today's Handoffs</div>
              <div className="text-2xl font-bold text-content">{specialistStats.todayCount}</div>
            </div>
            <div className="p-4 bg-surface-raised rounded-lg border border-divider">
              <div className="text-sm text-content-subtle mb-1">Merge Queue</div>
              <div className="text-2xl font-bold text-warning">
                {specialistStats.queueDepth}
              </div>
            </div>
            <div className="p-4 bg-surface-raised rounded-lg border border-divider">
              <div className="text-sm text-content-subtle mb-1">Success Rate</div>
              <div className="text-2xl font-bold text-success">
                {(specialistStats.successRate * 100).toFixed(0)}%
              </div>
            </div>
            <div className="p-4 bg-surface-raised rounded-lg border border-divider">
              <div className="text-sm text-content-subtle mb-1">Most Active</div>
              <div className="text-sm font-medium text-content">
                {Object.entries(specialistStats.bySpecialist)
                  .map(([name, counts]) => ({ name, total: counts.sent + counts.received }))
                  .sort((a, b) => b.total - a.total)[0]?.name || 'N/A'}
              </div>
            </div>
          </div>
        )}

        {/* Specialist Handoffs Table */}
        <div className="bg-surface-raised rounded-lg border border-divider overflow-hidden mt-6">
          <div className="p-4 border-b border-divider">
            <h3 className="text-lg font-semibold text-content">Recent Specialist Handoffs</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-emphasis text-left text-sm text-content-subtle">
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
                    <tr key={handoff.id} className="border-t border-divider hover:bg-surface-emphasis">
                      <td className="px-4 py-3 text-content-subtle">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTimestamp(handoff.timestamp)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-content">{handoff.issueId}</div>
                        {handoff.context?.branch && (
                          <div className="text-xs text-content-muted">{handoff.context.branch}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-xs rounded border ${
                              SPECIALIST_COLORS[
                                handoff.fromSpecialist as keyof typeof SPECIALIST_COLORS
                              ] || 'text-content-subtle bg-surface-overlay'
                            }`}
                          >
                            {handoff.fromSpecialist}
                          </span>
                          <ArrowRight className="w-3 h-3 text-content-muted" />
                          <span
                            className={`px-2 py-0.5 text-xs rounded border ${
                              SPECIALIST_COLORS[
                                handoff.toSpecialist as keyof typeof SPECIALIST_COLORS
                              ] || 'text-content-subtle bg-surface-overlay'
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
                          <span className="ml-2 text-xs text-content-muted">
                            ({handoff.result})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-content-subtle text-xs">
                        {handoff.context?.workspace || '-'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-content-muted">
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
