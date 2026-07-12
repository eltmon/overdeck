import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface BeadsHealth {
  localHead: string | null;
  lastPulledRemoteHead: string | null;
  lastSuccessfulPullAt: string | null;
  lastSuccessfulPushAt: string | null;
  freshnessAgeMs: number | null;
  lastConflict: string | null;
  lastSyncError: string | null;
  schemaVersion: number | null;
  designatedMigrator: boolean;
}

type MutableHealth = Omit<BeadsHealth, 'freshnessAgeMs' | 'schemaVersion' | 'designatedMigrator'>;
const health = new Map<string, MutableHealth>();

const empty = (): MutableHealth => ({
  localHead: null,
  lastPulledRemoteHead: null,
  lastSuccessfulPullAt: null,
  lastSuccessfulPushAt: null,
  lastConflict: null,
  lastSyncError: null,
});

export function updateBeadsTelemetry(projectKey: string, patch: Partial<MutableHealth>): void {
  health.set(projectKey, { ...(health.get(projectKey) ?? empty()), ...patch });
}

export function recordBeadsPull(projectKey: string, localHead: string | null, remoteHead: string | null, at = new Date()): void {
  updateBeadsTelemetry(projectKey, { localHead, lastPulledRemoteHead: remoteHead, lastSuccessfulPullAt: at.toISOString(), lastSyncError: null });
}

export function recordBeadsPush(projectKey: string, localHead: string | null, at = new Date()): void {
  updateBeadsTelemetry(projectKey, { localHead, lastSuccessfulPushAt: at.toISOString(), lastConflict: null });
}

export function recordBeadsSyncError(projectKey: string, message: string): void {
  updateBeadsTelemetry(projectKey, { lastSyncError: message });
}

export function recordBeadsConflict(projectKey: string, message: string): void {
  updateBeadsTelemetry(projectKey, { lastConflict: message });
}

function parseSchemaVersion(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const raw = record.schema_version ?? record.schemaVersion ?? (record.database as Record<string, unknown> | undefined)?.schema_version;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getBeadsHealth(
  projectKey: string,
  cwd: string,
  execute: (args: readonly string[], cwd: string) => Promise<string> = async (args, directory) => {
    const { stdout } = await execFileAsync('bd', [...args], { cwd: directory, encoding: 'utf8', timeout: 10_000 });
    return stdout;
  },
): Promise<BeadsHealth> {
  const state = health.get(projectKey) ?? empty();
  let schemaVersion: number | null = null;
  try { schemaVersion = parseSchemaVersion(JSON.parse(await execute(['context', '--json'], cwd))); } catch { /* surfaced by sync status */ }
  return {
    ...state,
    freshnessAgeMs: state.lastSuccessfulPullAt ? Math.max(0, Date.now() - Date.parse(state.lastSuccessfulPullAt)) : null,
    schemaVersion,
    designatedMigrator: process.env.BD_ALLOW_REMOTE_MIGRATE === '1',
  };
}
