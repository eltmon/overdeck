/**
 * PAN-4264: `instance_heartbeat`, at most once per 24 hours per install.
 *
 * The dashboard checks at boot and hourly (`dashboard_running: true`); the CLI
 * checks after each command (`dashboard_running: false`). A running dashboard
 * sends its own heartbeat within 24 hours, so a CLI that finds none in 24
 * hours knows no dashboard sent one. The last-sent time lives in
 * `~/.overdeck/telemetry-heartbeat.json`.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstanceHeartbeatProperties, TelemetryCountBucket } from '@overdeck/contracts';
import { getOverdeckHome } from '../paths.js';
import { getAnalyticsClientTypeForProcess, getAnalyticsService, type AnalyticsService } from './service.js';

export const INSTANCE_HEARTBEAT_INTERVAL_MS = 24 * 60 * 60_000;

export interface InstanceHeartbeatInput {
  dashboardRunning: boolean;
  listProjects: () => readonly unknown[];
  /** Agents with whether each has a live pane; the CLI passes `() => []`. */
  listAgents: () => Promise<ReadonlyArray<{ hasLivePane: boolean }>> | ReadonlyArray<{ hasLivePane: boolean }>;
  nowMs?: number;
  analytics?: Pick<AnalyticsService, 'capture'>;
}

function heartbeatFile(): string {
  return join(getOverdeckHome(), 'telemetry-heartbeat.json');
}

function bucketCount(value: number): TelemetryCountBucket {
  if (value <= 0) return '0';
  if (value <= 2) return '1-2';
  if (value <= 5) return '3-5';
  if (value <= 10) return '6-10';
  return '11+';
}

async function readLastSentAt(): Promise<number | null> {
  try {
    const parsed = JSON.parse(await readFile(heartbeatFile(), 'utf8')) as { lastSentAt?: unknown };
    const ms = typeof parsed.lastSentAt === 'string' ? Date.parse(parsed.lastSentAt) : Number.NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Send `instance_heartbeat` unless one was sent in the last 24 hours. Resolves true when sent. Never throws. */
export async function maybeSendInstanceHeartbeat(input: InstanceHeartbeatInput): Promise<boolean> {
  try {
    const nowMs = input.nowMs ?? Date.now();
    const last = await readLastSentAt();
    if (last !== null && nowMs - last < INSTANCE_HEARTBEAT_INTERVAL_MS) return false;

    const [projects, agents] = await Promise.all([
      Promise.resolve(input.listProjects()),
      Promise.resolve(input.listAgents()),
    ]);
    const properties: InstanceHeartbeatProperties = {
      project_count: bucketCount(projects.length),
      active_agent_count: bucketCount(agents.filter((agent) => agent.hasLivePane).length),
      dashboard_running: input.dashboardRunning,
    };
    (input.analytics ?? getAnalyticsService(getAnalyticsClientTypeForProcess())).capture('instance_heartbeat', properties);

    const file = heartbeatFile();
    await mkdir(getOverdeckHome(), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ lastSentAt: new Date(nowMs).toISOString() })}\n`);
    await rename(tmp, file);
    return true;
  } catch {
    return false;
  }
}
