export const OVERDECK_DASHBOARD_PROTOCOL_VERSION = 1;
export const OVERDECK_AGENT_PROTOCOL_VERSION = 1;

export type UpdateChannel = 'stable' | 'canary';
export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'ready' | 'error';
export type UpdateInstallMode = 'desktop' | 'npm' | 'development';
export type UpdateCompatibilityStatus = 'compatible' | 'active-agents-block' | 'unknown';

export interface UpdateSnapshot {
  phase: UpdatePhase;
  installMode: UpdateInstallMode;
  channel: UpdateChannel;
  currentVersion: string;
  targetVersion: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  releaseDate: string | null;
  compatibility: {
    status: UpdateCompatibilityStatus;
    currentDashboardProtocol: number;
    targetDashboardProtocol: number | null;
    currentAgentProtocol: number;
    targetAgentProtocol: number | null;
  };
  progress: { percent: number; transferred: number; total: number } | null;
  lastCheckedAt: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

const PHASES: readonly string[] = ['idle', 'checking', 'current', 'available', 'downloading', 'installing', 'ready', 'error'];

/** Runtime boundary check for HTTP and IPC snapshots. */
export function isUpdateSnapshot(value: unknown): value is UpdateSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  const compatibility = snapshot.compatibility as Record<string, unknown> | null;
  return PHASES.includes(String(snapshot.phase))
    && ['desktop', 'npm', 'development'].includes(String(snapshot.installMode))
    && ['stable', 'canary'].includes(String(snapshot.channel))
    && typeof snapshot.currentVersion === 'string'
    && (snapshot.targetVersion === null || typeof snapshot.targetVersion === 'string')
    && !!compatibility
    && ['compatible', 'active-agents-block', 'unknown'].includes(String(compatibility.status))
    && typeof compatibility.currentDashboardProtocol === 'number'
    && typeof compatibility.currentAgentProtocol === 'number'
    && (snapshot.lastCheckedAt === null || typeof snapshot.lastCheckedAt === 'string');
}
