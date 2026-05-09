import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Shield, ScrollText } from 'lucide-react';
import styles from './styles/command-deck.module.css';

interface SpecialistHealthState {
  specialistName: string;
  lastPingTime?: string;
  lastResponseTime?: string;
  consecutiveFailures: number;
  lastForceKillTime?: string;
  forceKillCount: number;
}

interface DeaconStatusData {
  isRunning: boolean;
  config: {
    patrolIntervalMs: number;
  };
  state: {
    specialists: Record<string, SpecialistHealthState>;
    lastPatrol?: string;
    patrolCycle: number;
  };
  lastPatrol?: {
    cycle: number;
    timestamp: string;
    actions: string[];
    massDeathDetected: boolean;
  } | null;
}

interface DeaconLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'action' | 'error';
  message: string;
  cycle?: number;
}

async function fetchDeaconStatus(): Promise<DeaconStatusData> {
  const res = await fetch('/api/deacon/status');
  if (!res.ok) throw new Error('Failed to fetch deacon status');
  return res.json();
}

async function fetchDeaconLogs(): Promise<{ logs: DeaconLogEntry[] }> {
  const res = await fetch('/api/deacon/logs?limit=50');
  if (!res.ok) throw new Error('Failed to fetch deacon logs');
  return res.json();
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function specialistStatusColor(health: SpecialistHealthState): string {
  if (health.consecutiveFailures >= 3) return 'var(--destructive)';
  if (health.consecutiveFailures > 0) return 'var(--warning)';
  if (health.lastForceKillTime) {
    const killAge = Date.now() - new Date(health.lastForceKillTime).getTime();
    if (killAge < 5 * 60 * 1000) return 'var(--warning)';
  }
  return 'var(--success)';
}

function formatSpecialistName(name: string): string {
  return name.replace('-agent', '');
}

function formatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  info: 'var(--muted-foreground)',
  warn: 'var(--warning)',
  action: 'var(--primary)',
  error: 'var(--destructive)',
};

const LOG_LEVEL_LABELS: Record<string, string> = {
  info: 'INF',
  warn: 'WRN',
  action: 'ACT',
  error: 'ERR',
};

export function DeaconStatus() {
  const [expanded, setExpanded] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery({
    queryKey: ['deacon-status'],
    queryFn: fetchDeaconStatus,
    refetchInterval: 15000,
  });

  const { data: logData } = useQuery({
    queryKey: ['deacon-logs'],
    queryFn: fetchDeaconLogs,
    refetchInterval: showLogs ? 5000 : false,  // Only poll when logs are visible
    enabled: showLogs,
  });

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (showLogs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logData, showLogs]);

  if (!status) return null;

  const specialists = Object.values(status.state.specialists || {});
  const actions = status.lastPatrol?.actions || [];
  const hasActions = actions.length > 0;
  const logs = logData?.logs || [];

  return (
    <div className={styles.deaconPanel}>
      <div className={styles.deaconHeader} onClick={() => setExpanded(!expanded)}>
        <Shield size={12} style={{ color: status.isRunning ? 'var(--success)' : 'var(--muted-foreground)', flexShrink: 0 }} />
        <span className={styles.deaconTitle}>Deacon</span>
        <span className={styles.deaconMeta}>
          {status.isRunning ? timeAgo(status.state.lastPatrol) : 'stopped'}
        </span>
        {hasActions && (
          <span className={styles.deaconActionCount}>{actions.length}</span>
        )}
        {expanded ? (
          <ChevronDown size={12} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={12} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
        )}
      </div>

      {/* Specialist rows — always visible */}
      <div className={styles.deaconSpecialists}>
        {specialists.map((spec) => (
          <div key={spec.specialistName} className={styles.deaconSpecRow}>
            <span
              className={styles.deaconSpecDot}
              style={{ background: specialistStatusColor(spec) }}
            />
            <span className={styles.deaconSpecName}>
              {formatSpecialistName(spec.specialistName)}
            </span>
            {spec.consecutiveFailures > 0 && (
              <span className={styles.deaconSpecFailures}>
                {spec.consecutiveFailures}x
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Expanded: actions + logs toggle */}
      {expanded && (
        <>
          {/* Recent actions */}
          {hasActions && (
            <div className={styles.deaconActions}>
              {actions.map((action, i) => (
                <div key={i} className={styles.deaconAction}>
                  {action}
                </div>
              ))}
            </div>
          )}

          {/* Log toggle button */}
          <div
            className={styles.deaconLogToggle}
            onClick={(e) => { e.stopPropagation(); setShowLogs(!showLogs); }}
          >
            <ScrollText size={10} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
            <span>{showLogs ? 'Hide logs' : 'Show logs'}</span>
          </div>

          {/* Log viewer */}
          {showLogs && (
            <div className={styles.deaconLogViewer}>
              {logs.length === 0 ? (
                <div className={styles.deaconLogEmpty}>No logs yet — waiting for patrol cycle...</div>
              ) : (
                logs.map((entry, i) => (
                  <div key={i} className={styles.deaconLogEntry}>
                    <span className={styles.deaconLogTime}>
                      {formatLogTime(entry.timestamp)}
                    </span>
                    <span
                      className={styles.deaconLogLevel}
                      style={{ color: LOG_LEVEL_COLORS[entry.level] || 'var(--muted-foreground)' }}
                    >
                      {LOG_LEVEL_LABELS[entry.level] || entry.level}
                    </span>
                    <span className={styles.deaconLogMessage}>{entry.message}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
