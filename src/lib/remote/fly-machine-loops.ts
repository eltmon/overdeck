/**
 * Keep Fly machines alive while used and destroy them when not (PAN-4652
 * WI-11, FR-14, FR-16, D-9).
 *
 * Both routines run every 60 s in the deacon child's hygiene scheduler, outside
 * the deacon freeze, over the records in `fly-machines.json`:
 *
 * - `heartbeatFlyMachines` writes the host heartbeat on every Fly machine, so
 *   its watchdog (installed at provisioning) does not stop it. When home stops
 *   heartbeating for 300 s, the VM stops itself.
 * - `sweepFlyMachines` destroys a machine, removes its link and deletes its
 *   record when the Fly API reports it `stopped`, `destroyed` or `failed` or
 *   answers 404 (positive evidence only; any other API error does nothing),
 *   when no linked conversation on it has been active for
 *   `remote.fly.machine_idle_minutes` (default 30, 0 disables), or when its
 *   provisioning never linked it within 30 minutes. A stopped Fly machine has
 *   lost its rootfs, so it is destroyed, never restarted.
 *
 * With zero records neither routine constructs a Fly client (NFR-1). Calls go
 * by the record's app and machine id through the API client (D-11). The idle
 * clock lives in memory: after a deacon restart the window starts again.
 */
import type { FlyMachineRecord } from '../anywhere/fly/machine-store.js';
import { listFlyMachines, removeFlyMachine } from '../anywhere/fly/machine-store.js';
import { destroyFlyVm, loadFlyApi } from '../anywhere/fly/provision.js';
import { removeLink } from '../anywhere/link-store.js';
import { emitActivityEntry } from '../activity-logger.js';
import { loadConfig } from '../config.js';
import { listLinkedConversations } from '../overdeck/linked-conversations.js';
import type { FlyApiClient } from './fly-api.js';
import { FlyApiError } from './fly-api.js';
import { REMOTE_HOST_HEARTBEAT_PATH } from './remote-agents.js';
import { REMOTE_PAN_DIR } from './remote-tmux.js';

const DEFAULT_IDLE_MINUTES = 30;
const UNLINKED_LIMIT_MS = 30 * 60_000;
const GONE_STATES = new Set(['stopped', 'destroyed', 'failed']);
const EXEC_TIMEOUT_SECONDS = 30;

type LoopApi = Pick<FlyApiClient, 'execCommand' | 'getMachine' | 'destroyMachine'>;

/** One linked conversation row, as far as the idle check reads it. */
export interface LinkedConversationActivity {
  environmentId: string;
  releasedTo: string | null;
  status: 'active' | 'ended';
  lastActivityAt: string | null;
}

export interface FlyMachineLoopDeps {
  listRecords: () => Promise<FlyMachineRecord[]>;
  /** Called only when there is at least one record (NFR-1). */
  api: () => Promise<LoopApi>;
  listConversations: () => LinkedConversationActivity[];
  idleMinutes: () => Promise<number>;
  removeLink: (linkId: string) => Promise<unknown>;
  removeRecord: (id: string) => Promise<unknown>;
  activity: (message: string, details: Record<string, unknown>) => void;
  now: () => number;
}

const defaultDeps: FlyMachineLoopDeps = {
  listRecords: listFlyMachines,
  api: loadFlyApi,
  listConversations: () => listLinkedConversations({ readOnly: true }).map((record) => ({
    environmentId: record.environmentId,
    releasedTo: record.row.releasedTo,
    status: record.row.status,
    lastActivityAt: record.row.lastActivityAt,
  })),
  idleMinutes: async () => (await loadConfig()).remote?.fly?.machine_idle_minutes ?? DEFAULT_IDLE_MINUTES,
  removeLink,
  removeRecord: removeFlyMachine,
  activity: (message, details) => emitActivityEntry({ source: 'cloister', level: 'info', message, details: JSON.stringify(details) }),
  now: Date.now,
};

/** Record id → when its machine was first seen with no active conversation. */
const idleSince = new Map<string, number>();

/** Test seam: no production caller; tests use it to reset the in-memory idle clocks. */
export function _resetFlyMachineLoopsForTests(): void {
  idleSince.clear();
}

/** FR-14: write the host heartbeat on every Fly machine. One line per machine; a failure never reads as refreshed. */
export async function heartbeatFlyMachines(overrides: Partial<FlyMachineLoopDeps> = {}): Promise<string[]> {
  const deps = { ...defaultDeps, ...overrides };
  const records = await deps.listRecords();
  if (records.length === 0) return [];
  const api = await deps.api();
  const command = `mkdir -p ${REMOTE_PAN_DIR} && date -u +%FT%TZ > ${REMOTE_HOST_HEARTBEAT_PATH}`;
  const lines: string[] = [];
  for (const record of records) {
    try {
      const result = await api.execCommand(record.appName, record.machineId, ['/bin/sh', '-c', command], EXEC_TIMEOUT_SECONDS);
      lines.push(result.exit_code === 0
        ? `refreshed host heartbeat on ${record.label}`
        : `failed to refresh host heartbeat on ${record.label}: exit ${result.exit_code} ${result.stderr.trim()}`);
    } catch (error) {
      lines.push(`failed to refresh host heartbeat on ${record.label}: ${(error as Error).message}`);
    }
  }
  return lines;
}

/** Why a linked record should go now, or null to keep it. Throws nothing; an indeterminate API answer keeps it. */
async function reasonToRemove(
  record: FlyMachineRecord,
  api: LoopApi,
  deps: FlyMachineLoopDeps,
  idleMs: number,
  conversations: LinkedConversationActivity[],
): Promise<string | null> {
  try {
    const machine = await api.getMachine(record.appName, record.machineId);
    if (GONE_STATES.has(machine.state)) return `machine ${machine.state}`;
  } catch (error) {
    if (error instanceof FlyApiError && error.statusCode === 404) return 'machine gone (404)';
    return null;
  }

  if (idleMs <= 0) return null;
  const now = deps.now();
  const active = conversations.some((row) =>
    row.environmentId === record.environmentId
    && row.releasedTo === null
    && (row.status === 'active' || (row.lastActivityAt !== null && now - Date.parse(row.lastActivityAt) < idleMs)));
  if (active) {
    idleSince.delete(record.id);
    return null;
  }
  const since = idleSince.get(record.id) ?? now;
  idleSince.set(record.id, since);
  return now - since >= idleMs ? `no active conversation for ${Math.round(idleMs / 60_000)} min` : null;
}

/** FR-16: destroy, unlink and forget Fly machines that are gone, idle, or never finished provisioning. */
export async function sweepFlyMachines(overrides: Partial<FlyMachineLoopDeps> = {}): Promise<string[]> {
  const deps = { ...defaultDeps, ...overrides };
  const records = await deps.listRecords();
  if (records.length === 0) return [];
  const api = await deps.api();
  const idleMs = Math.max(0, await deps.idleMinutes()) * 60_000;
  const conversations = idleMs > 0 ? deps.listConversations() : [];
  const lines: string[] = [];

  for (const record of records) {
    const reason = record.linkId === null
      ? (deps.now() - Date.parse(record.createdAt) >= UNLINKED_LIMIT_MS ? 'provisioning never linked it' : null)
      : await reasonToRemove(record, api, deps, idleMs, conversations);
    if (reason === null) continue;

    try {
      await destroyFlyVm(record.appName, record.machineId, { api });
    } catch (error) {
      lines.push(`could not destroy ${record.label} (${reason}): ${(error as Error).message}; will retry`);
      continue;
    }
    if (record.linkId !== null) await deps.removeLink(record.linkId);
    await deps.removeRecord(record.id);
    idleSince.delete(record.id);
    deps.activity(`Destroyed Fly machine ${record.label}: ${reason}`, { machineId: record.machineId, appName: record.appName, linkId: record.linkId, reason });
    lines.push(`destroyed ${record.label}: ${reason}`);
  }
  return lines;
}
