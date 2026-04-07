/**
 * Cloister Status Bar Component
 *
 * Displays Cloister service status and agent health summary in the dashboard header.
 */

import { useQuery } from '@tanstack/react-query';
import { Bell, BellOff, AlertTriangle, StopCircle, Settings, Zap } from 'lucide-react';
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

export function CloisterStatusBar({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const { data: status, refetch } = useQuery({
    queryKey: ['cloister-status'],
    queryFn: fetchCloisterStatus,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const { data: specialistsData } = useQuery({
    queryKey: ['specialists-raw'],
    queryFn: async () => {
      const res = await fetch('/api/specialists');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30000,
  });

  const runningEphemeral: Array<{ projectKey: string; specialistType: string }> =
    (specialistsData?.projects ?? []).filter((p: { isRunning: boolean }) => p.isRunning);

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

  if (!status) {
    return null;
  }

  const hasWarnings = status.summary.warning > 0 || status.summary.stuck > 0;
  const needsAttention = status.agentsNeedingAttention.length;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {/* Cloister Status Indicator */}
      <div className="flex items-center gap-1" title={status.running ? 'Cloister: Running' : 'Cloister: Stopped'}>
        {status.running ? (
          <Bell className="w-3.5 h-3.5 text-success" />
        ) : (
          <BellOff className="w-3.5 h-3.5 text-content-muted" />
        )}
      </div>

      {/* Agent Summary */}
      {status.running && status.summary.total > 0 && (
        <div className="flex items-center gap-1 text-xs">
          {status.summary.active > 0 && (
            <span className="text-success">{status.summary.active}</span>
          )}
          {status.summary.warning > 0 && (
            <span className="text-warning">{status.summary.warning}</span>
          )}
          {status.summary.stuck > 0 && (
            <span className="text-destructive">{status.summary.stuck}</span>
          )}
        </div>
      )}

      {/* Running Ephemeral Specialists Indicator */}
      {runningEphemeral.length > 0 && (
        <span
          className="flex items-center gap-0.5 text-xs text-success"
          title={`Ephemeral: ${runningEphemeral.map(p => `${p.projectKey.toUpperCase()} ${p.specialistType}`).join(', ')}`}
        >
          <Zap className="w-3 h-3" />
          {runningEphemeral.length}
        </span>
      )}

      {/* Warning Indicator */}
      {hasWarnings && (
        <span title={`${needsAttention} agent${needsAttention !== 1 ? 's' : ''} need attention`}>
          <AlertTriangle className="w-3.5 h-3.5 text-warning" />
        </span>
      )}

      {/* Control Buttons */}
      <div className="flex items-center gap-1">
        {/* Toggle Monitoring */}
        <button
          onClick={handleToggle}
          disabled={isToggling}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            isToggling
              ? 'bg-surface-emphasis text-content-subtle cursor-wait'
              : status.running
              ? 'bg-surface-overlay text-content-body hover:bg-surface-emphasis'
              : 'bg-primary text-white hover:bg-primary/90'
          }`}
        >
          {isToggling
            ? (status.running ? '...' : '...')
            : (status.running ? 'Pause' : 'Start')}
        </button>

        {/* Emergency Stop */}
        {!showEmergencyConfirm ? (
          <button
            onClick={() => setShowEmergencyConfirm(true)}
            className="p-1 rounded text-xs badge-bg-destructive text-destructive border badge-border-destructive hover:bg-destructive/20 transition-colors"
            title="Emergency stop - kill all agents"
          >
            <StopCircle className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div className="flex items-center gap-1 px-2 py-0.5 badge-bg-destructive rounded border badge-border-destructive">
            <span className="text-xs text-destructive">Kill all?</span>
            <button
              onClick={handleEmergencyStop}
              className="px-1.5 py-0.5 rounded text-xs bg-destructive text-white hover:bg-destructive/90"
            >
              Yes
            </button>
            <button
              onClick={() => setShowEmergencyConfirm(false)}
              className="px-1.5 py-0.5 rounded text-xs bg-surface-overlay text-content-body hover:bg-surface-emphasis"
            >
              No
            </button>
          </div>
        )}

        {/* Settings — navigates to Settings page */}
        <button
          onClick={onOpenSettings}
          className="p-1 rounded text-xs bg-surface-overlay text-content-body hover:bg-surface-emphasis transition-colors"
          title="Open Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
