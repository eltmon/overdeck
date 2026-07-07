import { getEventLoopDelaySample, type EventLoopDelaySample } from '../../services/event-loop-monitor.js';
import { readDurableDeaconStatus } from '../../services/cloister-control-surface.js';
import type { HostProcessRecord } from './host-processes.js';

export interface CoreServicesProcess {
  uptimeSeconds: number;
  nodeVersion: string;
  distPath: string;
  cpuPercent: number;
  memoryBytes: number;
}

export interface CoreServicesDeaconStatus {
  isRunning: boolean;
  pid: number | null;
  state?: {
    lastPatrol?: string | null;
    patrolCycle?: number;
    stuckCount?: number;
  };
  lastPatrol?: {
    cycle: number;
    timestamp: string;
    actions: string[];
    massDeathDetected?: boolean;
  } | null;
}

export interface CoreServicesOptions {
  eventLoopSample?: EventLoopDelaySample;
  processInfo?: CoreServicesProcess;
  deaconStatus?: CoreServicesDeaconStatus;
  supportProcesses?: HostProcessRecord[];
  nowMs?: number;
}

export interface CoreServiceAction {
  label: string;
  href: string;
  method: 'GET' | 'POST';
}

export interface CoreServiceRow {
  id: 'dashboard' | 'deacon' | 'support-fleet';
  label: string;
  status: 'running' | 'stopped' | 'unknown';
  cpuPercent: number;
  memoryBytes: number;
  memberCount: number;
  actions: CoreServiceAction[];
  nodeVersion?: string;
  distPath?: string;
  uptime?: string;
  uptimeSeconds?: number;
  eventLoopP99Ms?: number;
  pid?: number | null;
  lastTickAgeSeconds?: number | null;
  patrolCycle?: number;
  patrolSummaryCount?: number;
  stuckCount?: number;
  members?: string[];
}

export function buildCoreServices(options: CoreServicesOptions = {}): CoreServiceRow[] {
  const nowMs = options.nowMs ?? Date.now();
  const processInfo = options.processInfo ?? getCurrentProcessInfo();
  const eventLoopSample = options.eventLoopSample ?? getEventLoopDelaySample();
  const deaconStatus = options.deaconStatus ?? readDurableDeaconStatus();
  const supportFleet = aggregateSupportFleet(options.supportProcesses ?? []);

  return [
    {
      id: 'dashboard',
      label: 'Dashboard server',
      status: 'running',
      cpuPercent: processInfo.cpuPercent,
      memoryBytes: processInfo.memoryBytes,
      memberCount: 1,
      nodeVersion: processInfo.nodeVersion,
      distPath: processInfo.distPath,
      uptime: formatDuration(processInfo.uptimeSeconds),
      uptimeSeconds: Math.round(processInfo.uptimeSeconds),
      eventLoopP99Ms: eventLoopSample.p99,
      actions: [
        { label: 'Metrics', href: '/api/metrics/summary', method: 'GET' },
      ],
    },
    {
      id: 'deacon',
      label: 'Deacon',
      status: deaconStatus.isRunning ? 'running' : 'stopped',
      cpuPercent: 0,
      memoryBytes: 0,
      memberCount: deaconStatus.pid ? 1 : 0,
      pid: deaconStatus.pid,
      lastTickAgeSeconds: getLastTickAgeSeconds(deaconStatus, nowMs),
      patrolCycle: deaconStatus.lastPatrol?.cycle ?? deaconStatus.state?.patrolCycle ?? 0,
      patrolSummaryCount: deaconStatus.lastPatrol?.actions.length ?? 0,
      stuckCount: deaconStatus.state?.stuckCount ?? 0,
      actions: [
        { label: 'Status', href: '/api/deacon/status', method: 'GET' },
        { label: 'Logs', href: '/api/deacon/logs', method: 'GET' },
        { label: 'Patrol', href: '/api/deacon/patrol', method: 'POST' },
      ],
    },
    {
      id: 'support-fleet',
      label: 'Support fleet',
      status: supportFleet.memberCount > 0 ? 'running' : 'unknown',
      cpuPercent: supportFleet.cpuPercent,
      memoryBytes: supportFleet.memoryBytes,
      memberCount: supportFleet.memberCount,
      members: supportFleet.members,
      actions: [],
    },
  ];
}

export function getCoreServicesSnapshot(): CoreServiceRow[] {
  return buildCoreServices();
}

function getCurrentProcessInfo(): CoreServicesProcess {
  return {
    uptimeSeconds: process.uptime(),
    nodeVersion: process.version,
    distPath: process.argv.find((arg) => arg.includes('/dist/')) ?? process.argv[1] ?? '',
    cpuPercent: 0,
    memoryBytes: process.memoryUsage().rss,
  };
}

function aggregateSupportFleet(processes: HostProcessRecord[]): Pick<
  CoreServiceRow,
  'cpuPercent' | 'memoryBytes' | 'memberCount' | 'members'
> {
  const supportProcesses = processes.filter(isSupportFleetProcess);
  const members = supportProcesses.map((process) => process.command);

  return {
    cpuPercent: roundOneDecimal(
      supportProcesses.reduce((sum, process) => sum + process.cpuPercent, 0),
    ),
    memoryBytes: supportProcesses.reduce((sum, process) => sum + process.memoryBytes, 0),
    memberCount: supportProcesses.length,
    members,
  };
}

function isSupportFleetProcess(process: HostProcessRecord): boolean {
  return /\b(traefik|smee|pty-supervisor|pty-supervisors|tldr)\b/i.test(process.command);
}

function getLastTickAgeSeconds(
  deaconStatus: CoreServicesDeaconStatus,
  nowMs: number,
): number | null {
  const timestamp = deaconStatus.lastPatrol?.timestamp ?? deaconStatus.state?.lastPatrol;
  if (!timestamp) return null;

  const tickMs = Date.parse(timestamp);
  if (!Number.isFinite(tickMs)) return null;

  return Math.max(0, Math.floor((nowMs - tickMs) / 1000));
}

function formatDuration(totalSeconds: number): string {
  const roundedSeconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(roundedSeconds / 86_400);
  const hours = Math.floor((roundedSeconds % 86_400) / 3_600);
  const minutes = Math.floor((roundedSeconds % 3_600) / 60);
  const seconds = roundedSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
