/**
 * Cloister Status Bar Component
 *
 * Displays Cloister service status and agent health summary in the dashboard header.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, AlertTriangle, StopCircle, Settings } from 'lucide-react';
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

interface CloisterConfig {
  startup: {
    auto_start: boolean;
  };
  thresholds: {
    stale_minutes: number;
    warning_minutes: number;
    stuck_minutes: number;
  };
  specialists: {
    enabled: string[];
  };
}

async function fetchCloisterStatus(): Promise<CloisterStatus> {
  const res = await fetch('/api/cloister/status');
  if (!res.ok) throw new Error('Failed to fetch Cloister status');
  return res.json();
}

async function fetchCloisterConfig(): Promise<CloisterConfig> {
  const res = await fetch('/api/cloister/config');
  if (!res.ok) throw new Error('Failed to fetch Cloister config');
  return res.json();
}

async function updateCloisterConfig(config: Partial<CloisterConfig>): Promise<void> {
  const res = await fetch('/api/cloister/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to update Cloister config');
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
  const [showSettings, setShowSettings] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const queryClient = useQueryClient();

  const { data: status, refetch } = useQuery({
    queryKey: ['cloister-status'],
    queryFn: fetchCloisterStatus,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const { data: config } = useQuery({
    queryKey: ['cloister-config'],
    queryFn: fetchCloisterConfig,
  });

  const configMutation = useMutation({
    mutationFn: updateCloisterConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cloister-config'] });
    },
  });

  const handleToggle = async () => {
    setIsToggling(true);
    try {
      if (status?.running) {
        await stopCloister();
      } else {
        await startCloister();
      }
      await refetch();
    } finally {
      setIsToggling(false);
    }
  };

  const handleEmergencyStop = async () => {
    await emergencyStop();
    setShowEmergencyConfirm(false);
    refetch();
  };

  const handleAutoStartToggle = () => {
    if (!config) return;
    configMutation.mutate({
      startup: { auto_start: !config.startup.auto_start },
    });
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
          disabled={isToggling}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            isToggling
              ? 'bg-gray-600 text-gray-400 cursor-wait'
              : status.running
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isToggling
            ? (status.running ? 'Stopping...' : 'Starting...')
            : (status.running ? 'Pause' : 'Start')}
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

        {/* Settings */}
        <div className="relative">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              showSettings
                ? 'bg-gray-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            title="Cloister settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Settings Dropdown */}
          {showSettings && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50">
              <div className="p-3">
                <div className="text-xs text-gray-400 font-medium mb-2">Settings</div>

                {/* Auto-start checkbox */}
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-700/50 rounded px-2 py-1.5 -mx-2">
                  <input
                    type="checkbox"
                    checked={config?.startup.auto_start ?? true}
                    onChange={handleAutoStartToggle}
                    disabled={configMutation.isPending}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
                  />
                  <span className="text-sm text-gray-300">
                    Auto-start on dashboard launch
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
