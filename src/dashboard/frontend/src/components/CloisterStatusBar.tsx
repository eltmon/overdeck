/**
 * Cloister Status Bar Component
 *
 * Displays Cloister service status and agent health summary in the dashboard header.
 */

import { useQuery } from '@tanstack/react-query';
import { Bell, BellOff, AlertTriangle, StopCircle } from 'lucide-react';
import { useState } from 'react';

interface CloisterStatus {
  running: boolean;
  lastCheck: string | null;
  summary: {
    active: number;
    stale: number;
    warning: number;
    stuck: number;
    total: number;
  };
  agentsNeedingAttention: string[];
}

async function fetchCloisterStatus(): Promise<CloisterStatus> {
  const res = await fetch('/api/cloister/status');
  if (!res.ok) throw new Error('Failed to fetch Cloister status');
  return res.json();
}

async function startCloister(): Promise<void> {
  const res = await fetch('/api/cloister/start', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start Cloister');
}

async function stopCloister(): Promise<void> {
  const res = await fetch('/api/cloister/stop', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop Cloister');
}

async function emergencyStop(): Promise<{ killedAgents: string[] }> {
  const res = await fetch('/api/cloister/emergency-stop', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to execute emergency stop');
  return res.json();
}

export function CloisterStatusBar() {
  const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);

  const { data: status, refetch } = useQuery({
    queryKey: ['cloister-status'],
    queryFn: fetchCloisterStatus,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const handleToggle = async () => {
    if (status?.running) {
      await stopCloister();
    } else {
      await startCloister();
    }
    refetch();
  };

  const handleEmergencyStop = async () => {
    await emergencyStop();
    setShowEmergencyConfirm(false);
    refetch();
  };

  if (!status) {
    return null;
  }

  const hasWarnings = status.summary.warning > 0 || status.summary.stuck > 0;
  const needsAttention = status.agentsNeedingAttention.length;

  return (
    <div className="flex items-center gap-4">
      {/* Cloister Status Indicator */}
      <div className="flex items-center gap-2">
        {status.running ? (
          <Bell className="w-5 h-5 text-green-400" />
        ) : (
          <BellOff className="w-5 h-5 text-gray-500" />
        )}
        <span className="text-sm text-gray-300">
          {status.running ? 'Cloister: Running' : 'Cloister: Stopped'}
        </span>
      </div>

      {/* Agent Summary */}
      {status.running && status.summary.total > 0 && (
        <div className="flex items-center gap-3 text-xs">
          {status.summary.active > 0 && (
            <span className="text-green-400">
              🟢 {status.summary.active}
            </span>
          )}
          {status.summary.stale > 0 && (
            <span className="text-yellow-400">
              🟡 {status.summary.stale}
            </span>
          )}
          {status.summary.warning > 0 && (
            <span className="text-orange-400">
              🟠 {status.summary.warning}
            </span>
          )}
          {status.summary.stuck > 0 && (
            <span className="text-red-400">
              🔴 {status.summary.stuck}
            </span>
          )}
        </div>
      )}

      {/* Warning Indicator */}
      {hasWarnings && (
        <div className="flex items-center gap-2 px-3 py-1 bg-orange-500/20 rounded-lg border border-orange-500/30">
          <AlertTriangle className="w-4 h-4 text-orange-400" />
          <span className="text-xs text-orange-300">
            {needsAttention} agent{needsAttention !== 1 ? 's' : ''} need attention
          </span>
        </div>
      )}

      {/* Control Buttons */}
      <div className="flex items-center gap-2">
        {/* Toggle Monitoring */}
        <button
          onClick={handleToggle}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            status.running
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {status.running ? 'Pause' : 'Start'}
        </button>

        {/* Emergency Stop */}
        {!showEmergencyConfirm ? (
          <button
            onClick={() => setShowEmergencyConfirm(true)}
            className="px-3 py-1 rounded text-xs bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors"
            title="Emergency stop - kill all agents"
          >
            <StopCircle className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1 bg-red-600/20 rounded border border-red-600/30">
            <span className="text-xs text-red-300">Confirm?</span>
            <button
              onClick={handleEmergencyStop}
              className="px-2 py-0.5 rounded text-xs bg-red-600 text-white hover:bg-red-700"
            >
              Yes
            </button>
            <button
              onClick={() => setShowEmergencyConfirm(false)}
              className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600"
            >
              No
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
