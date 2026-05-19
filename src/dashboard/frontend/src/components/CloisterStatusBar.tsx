/**
 * Cloister Status Bar Component
 *
 * Displays Cloister service status and agent health summary in the dashboard header.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, AlertTriangle, StopCircle, Settings, Zap, RefreshCw } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDashboardStore, selectAgentList } from '../lib/store';

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

interface DashboardSettings {
  tts?: {
    enabled?: boolean;
  };
}

interface TtsHealthStatus {
  ok: boolean;
  running: boolean;
  pid: number | null;
  queue?: unknown;
  queueDepth?: number;
  model?: unknown;
  uptimeSeconds?: number;
  gpuMemoryUsedMb?: number;
  error?: string;
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

async function fetchConversations(): Promise<{ sessionAlive: boolean }[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) return [];
  return res.json();
}

async function fetchDashboardSettings(): Promise<DashboardSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

async function fetchTtsHealth(): Promise<TtsHealthStatus> {
  const res = await fetch('/api/tts/health');
  if (!res.ok) throw new Error('Failed to fetch TTS health');
  return res.json();
}

function formatTtsHealthTitle(health: TtsHealthStatus | undefined, failed: boolean): string {
  if (failed) return 'TTS: Health check failed';
  if (!health) return 'TTS: Checking daemon';
  if (!health.ok) return health.error ? `TTS: ${health.error}` : 'TTS: Daemon offline';

  const details = [
    health.model !== undefined ? `model: ${String(health.model)}` : undefined,
    health.queueDepth !== undefined ? `queue: ${String(health.queueDepth)}` : health.queue !== undefined ? `queue: ${String(health.queue)}` : undefined,
    typeof health.pid === 'number' ? `pid: ${health.pid}` : undefined,
    health.gpuMemoryUsedMb !== undefined ? `VRAM: ${health.gpuMemoryUsedMb}MB` : undefined,
  ].filter(Boolean);
  return details.length > 0 ? `TTS: Running (${details.join(', ')})` : 'TTS: Running';
}

export function CloisterStatusBar({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);
  const [showRestartPopover, setShowRestartPopover] = useState(false);
  const [restartConversations, setRestartConversations] = useState(true);
  const [restartAgents, setRestartAgents] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(null);
  const queryClient = useQueryClient();

  const { data: status, refetch } = useQuery({
    queryKey: ['cloister-status'],
    queryFn: fetchCloisterStatus,
    refetchInterval: 10000,
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

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchDashboardSettings,
    retry: false,
  });
  const ttsEnabled = settings?.tts?.enabled === true;

  const { data: ttsHealth, isError: ttsHealthFailed } = useQuery({
    queryKey: ['tts-health'],
    queryFn: fetchTtsHealth,
    enabled: ttsEnabled,
    refetchInterval: 10000,
    retry: false,
  });

  const agents = useDashboardStore(selectAgentList);
  const runningAgentCount = agents.filter(a => a.status === 'running').length;
  const aliveConversationCount = conversations.filter(c => c.sessionAlive).length;

  const runningEphemeral: Array<{ projectKey: string; specialistType: string }> =
    (specialistsData?.projects ?? []).filter((p: { isRunning: boolean }) => p.isRunning);

  const openPopover = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopoverPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
    setShowRestartPopover(true);
  }, []);

  // Close popover on outside click
  useEffect(() => {
    if (!showRestartPopover) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setShowRestartPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showRestartPopover]);

  const restartMutation = useMutation({
    mutationFn: async ({ convs, doAgents }: { convs: boolean; doAgents: boolean }) => {
      const promises: Promise<Response>[] = [];
      if (convs) promises.push(fetch('/api/conversations/restart-all', { method: 'POST' }));
      if (doAgents) promises.push(fetch('/api/agents/restart-all', { method: 'POST' }));
      const results = await Promise.all(promises);
      for (const r of results) {
        if (!r.ok) throw new Error(`Restart failed: ${r.statusText}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      refetch();
      setShowRestartPopover(false);
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

  const handleRestart = () => {
    if (!restartConversations && !restartAgents) return;
    restartMutation.mutate({ convs: restartConversations, doAgents: restartAgents });
  };

  if (!status) {
    return null;
  }

  const hasWarnings = status.summary.warning > 0 || status.summary.stuck > 0;
  const needsAttention = status.agentsNeedingAttention.length;
  const ttsDotClass = ttsHealthFailed
    ? 'bg-destructive'
    : ttsHealth?.ok
    ? 'bg-success'
    : 'bg-muted-foreground';

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {/* Cloister Status Indicator */}
      <div className="flex items-center gap-1" title={status.running ? 'Cloister: Running' : 'Cloister: Stopped'}>
        {status.running ? (
          <Bell className="w-3.5 h-3.5 text-success" />
        ) : (
          <BellOff className="w-3.5 h-3.5 text-muted-foreground" />
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

      {ttsEnabled && (
        <span
          data-testid="tts-health-badge"
          className="flex items-center gap-1 rounded bg-popover px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          title={formatTtsHealthTitle(ttsHealth, ttsHealthFailed)}
        >
          <span data-testid="tts-health-dot" className={`h-1.5 w-1.5 rounded-full ${ttsDotClass}`} />
          TTS
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
              ? 'bg-card text-muted-foreground cursor-wait'
              : status.running
              ? 'bg-popover text-foreground hover:bg-card'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {isToggling
            ? (status.running ? '...' : '...')
            : (status.running ? 'Pause' : 'Start')}
        </button>

        {/* Restart Sessions */}
        <button
          ref={buttonRef}
          onClick={() => showRestartPopover ? setShowRestartPopover(false) : openPopover()}
          className="p-1 rounded text-xs bg-popover text-foreground border border-border hover:bg-card transition-colors"
          title="Restart sessions"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${restartMutation.isPending ? 'animate-spin' : ''}`} />
        </button>
        {showRestartPopover && popoverPos && createPortal(
          <div
            ref={popoverRef}
            style={{ position: 'fixed', zIndex: 9999, left: popoverPos.left, bottom: popoverPos.bottom, width: 256, borderRadius: 6, border: '1px solid var(--border, #333)', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', backgroundColor: 'var(--card, #0c1018)' }}
          >
              <div className="px-3 py-2 text-xs font-semibold text-foreground border-b border-border">
                Restart Sessions
              </div>
              <div className="p-2 space-y-1">
                <label className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-foreground hover:bg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restartConversations}
                    onChange={e => setRestartConversations(e.target.checked)}
                    className="accent-primary"
                  />
                  <span>Conversations</span>
                  <span className="ml-auto text-muted-foreground">({aliveConversationCount} active)</span>
                </label>
                <label className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-foreground hover:bg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restartAgents}
                    onChange={e => setRestartAgents(e.target.checked)}
                    className="accent-primary"
                  />
                  <span>Workspace Agents</span>
                  <span className="ml-auto text-muted-foreground">({runningAgentCount} active)</span>
                </label>
              </div>
              <div className="flex justify-end gap-1.5 px-3 py-2 border-t border-border">
                <button
                  onClick={() => setShowRestartPopover(false)}
                  className="px-2 py-1 rounded text-xs text-foreground bg-muted hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRestart}
                  disabled={restartMutation.isPending || (!restartConversations && !restartAgents)}
                  className="px-2 py-1 rounded text-xs text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {restartMutation.isPending ? 'Restarting...' : 'Restart'}
                </button>
              </div>
              {restartMutation.isError && (
                <div className="px-3 py-1.5 text-xs text-destructive border-t border-border">
                  {(restartMutation.error as Error).message}
                </div>
              )}
          </div>,
          document.body,
        )}

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
              className="px-1.5 py-0.5 rounded text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes
            </button>
            <button
              onClick={() => setShowEmergencyConfirm(false)}
              className="px-1.5 py-0.5 rounded text-xs bg-popover text-foreground hover:bg-card"
            >
              No
            </button>
          </div>
        )}

        {/* Settings — navigates to Settings page */}
        <button
          onClick={onOpenSettings}
          className="p-1 rounded text-xs bg-popover text-foreground hover:bg-card transition-colors"
          title="Open Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
