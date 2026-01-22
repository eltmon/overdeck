import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Activity, Brain, BarChart3 } from 'lucide-react';
import { TerminalView } from './TerminalView';
import { HealthHistoryTimeline } from './HealthHistoryTimeline';
import { HealthHistoryChart } from './HealthHistoryChart';

interface AgentDetailViewProps {
  agentId: string | null;
  onClose: () => void;
}

interface AgentHealthHistory {
  agentId: string;
  startTime: string;
  endTime: string;
  events: HealthEvent[];
}

interface HealthEvent {
  id: number;
  agentId: string;
  timestamp: string;
  state: 'active' | 'stale' | 'warning' | 'stuck';
  previousState?: string;
  source?: string;
  metadata?: Record<string, any>;
}

interface SpecialistStatus {
  name: string;
  displayName: string;
  state: 'sleeping' | 'active' | 'uninitialized';
  sessionId?: string;
  contextTokens?: number;
  lastWake?: string;
}

async function fetchHealthHistory(agentId: string, hours: number = 24): Promise<AgentHealthHistory> {
  const res = await fetch(`/api/agents/${agentId}/health-history?hours=${hours}`);
  if (!res.ok) throw new Error('Failed to fetch health history');
  return res.json();
}

async function fetchSpecialists(): Promise<SpecialistStatus[]> {
  const res = await fetch('/api/specialists');
  if (!res.ok) throw new Error('Failed to fetch specialists');
  return res.json();
}

const HEALTH_STATE_EMOJI = {
  active: '🟢',
  stale: '🟡',
  warning: '🟠',
  stuck: '🔴',
};


function formatDuration(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffHours > 0) {
    return `${diffHours}h ${diffMins % 60}m ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return 'Just now';
  }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  } else if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function isSpecialistAgent(agentId: string): boolean {
  return agentId.startsWith('specialist-');
}

export function AgentDetailView({ agentId, onClose }: AgentDetailViewProps) {
  const [historyHours, setHistoryHours] = useState(24);
  const [showChart, setShowChart] = useState(false);

  const { data: healthHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['health-history', agentId, historyHours],
    queryFn: () => (agentId ? fetchHealthHistory(agentId, historyHours) : null),
    enabled: !!agentId,
    refetchInterval: 30000,
  });

  const { data: specialists } = useQuery({
    queryKey: ['specialists'],
    queryFn: fetchSpecialists,
    enabled: !!agentId && isSpecialistAgent(agentId || ''),
  });

  if (!agentId) return null;

  const specialist = specialists?.find((s) => `specialist-${s.name}` === agentId);
  const isSpecialist = isSpecialistAgent(agentId);
  const latestEvent = healthHistory?.events[healthHistory.events.length - 1];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-start justify-end">
      <div className="bg-gray-900 w-full max-w-4xl h-full shadow-xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-850">
          <div className="flex items-center gap-3">
            {isSpecialist ? (
              <Brain className="w-6 h-6 text-purple-400" />
            ) : (
              <Activity className="w-6 h-6 text-blue-400" />
            )}
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                {agentId}
                {latestEvent && (
                  <span className="text-xs">
                    {HEALTH_STATE_EMOJI[latestEvent.state]}
                  </span>
                )}
              </h2>
              {isSpecialist && specialist && (
                <div className="text-sm text-gray-400 mt-1">
                  {specialist.displayName}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Specialist Info Section */}
          {isSpecialist && specialist && (
            <div className="px-6 py-4 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                Specialist Info
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500">State</div>
                  <div className="text-sm text-white mt-1">{specialist.state}</div>
                </div>
                {specialist.sessionId && (
                  <div>
                    <div className="text-xs text-gray-500">Session ID</div>
                    <div className="text-sm font-mono text-white mt-1">
                      {specialist.sessionId.slice(0, 12)}...
                    </div>
                  </div>
                )}
                {specialist.contextTokens && (
                  <div>
                    <div className="text-xs text-gray-500">Context Size</div>
                    <div className="text-sm text-white mt-1">
                      {formatTokens(specialist.contextTokens)} tokens
                    </div>
                  </div>
                )}
                {specialist.lastWake && (
                  <div>
                    <div className="text-xs text-gray-500">Last Wake</div>
                    <div className="text-sm text-white mt-1">
                      {formatDuration(specialist.lastWake)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Health History Section */}
          <div className="px-6 py-4 border-b border-gray-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Health History
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowChart(!showChart)}
                  className={`p-2 rounded ${
                    showChart ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'
                  }`}
                  title={showChart ? 'Show timeline' : 'Show chart'}
                >
                  <BarChart3 className="w-4 h-4" />
                </button>
                <select
                  value={historyHours}
                  onChange={(e) => setHistoryHours(Number(e.target.value))}
                  className="text-sm bg-gray-800 text-white rounded px-2 py-1 border border-gray-700"
                >
                  <option value={1}>Last 1 hour</option>
                  <option value={6}>Last 6 hours</option>
                  <option value={24}>Last 24 hours</option>
                  <option value={72}>Last 3 days</option>
                  <option value={168}>Last 7 days</option>
                </select>
              </div>
            </div>

            {historyLoading ? (
              <div className="text-gray-500 text-sm py-4">Loading health history...</div>
            ) : healthHistory && healthHistory.events.length > 0 ? (
              <div>
                <div className="text-sm text-gray-400 mb-3">
                  {healthHistory.events.length} events from{' '}
                  {formatDuration(healthHistory.startTime)}
                </div>
                {showChart ? (
                  <HealthHistoryChart
                    events={healthHistory.events}
                    startTime={healthHistory.startTime}
                    endTime={healthHistory.endTime}
                  />
                ) : (
                  <HealthHistoryTimeline
                    events={healthHistory.events}
                    startTime={healthHistory.startTime}
                    endTime={healthHistory.endTime}
                  />
                )}
              </div>
            ) : (
              <div className="text-gray-500 text-sm py-4">
                No health history available
              </div>
            )}
          </div>

          {/* Terminal Output Section */}
          <div className="px-6 py-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">
              Terminal Output
            </h3>
            <div className="bg-gray-950 rounded-lg overflow-hidden">
              <TerminalView agentId={agentId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
