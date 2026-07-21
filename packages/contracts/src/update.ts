export const OVERDECK_DASHBOARD_PROTOCOL_VERSION = 1;
export const OVERDECK_AGENT_PROTOCOL_VERSION = 1;

export type UpdateChannel = 'stable' | 'canary';
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'error';
export type UpdateInstallMode = 'desktop' | 'npm-global' | 'development';
export type UpdateCompatibility = 'compatible' | 'active-agents-block' | 'unknown';

export interface UpdateSnapshot {
  phase: UpdatePhase;
  installMode: UpdateInstallMode;
  channel: UpdateChannel;
  currentVersion: string;
  targetVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  progressPercent: number | null;
  error: string | null;
  lastCheckedAt: string | null;
  compatibility: UpdateCompatibility;
  currentDashboardProtocol: number;
  currentAgentProtocol: number;
  targetDashboardProtocol: number | null;
  targetAgentProtocol: number | null;
}
