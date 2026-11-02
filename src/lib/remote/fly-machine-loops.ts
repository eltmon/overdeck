/**
 * Keep Fly machines alive while used and destroy them when not (PAN-4652
 * WI-11, FR-14, FR-16, D-9), and keep their Codex sign-in in step with home's
 * (PAN-4296 WI-7, FR-10).
 *
 * All three routines run every 60 s in the deacon child's hygiene scheduler,
 * outside the deacon freeze, over the records in `fly-machines.json`:
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
 *   lost its rootfs, so it is destroyed, never restarted. A machine that hosts
 *   a linked work agent whose remote-state is `starting` or `running` is never
 *   removed for idleness: the reap tears it down after the hand-off to review
 *   (PAN-4734 FR-11, D-8).
 * - `syncFlyCodexAuth` reads the Codex `auth.json` of every linked machine with
 *   a `codexAuthPath` and decides by newest refresh wins (PAN-4296 D-3): it
 *   pushes home's sign-in, copies a newer VM refresh home, or does nothing. A
 *   VM that does not answer is skipped until the next tick. No sign-in content
 *   reaches a log line or an activity entry.
 *
 * With no matching record no routine constructs a Fly client (NFR-1). Calls go
 * by the record's app and machine id through the API client (D-11). The idle
 * clock lives in memory: after a deacon restart the window starts again.
 *
 * A rejected Fly token (PAN-4748) is reported per machine as `Fly token
 * rejected`; the sweep keeps the record rather than destroying it.
 */
import { readFile } from 'node:fs/promises';

import { decideCodexAuthSync, parseCodexAuthSnapshot, pushVmCodexAuth, readVmCodexAuth, writeHomeCodexAuth } from '../anywhere/fly/codex-auth.js';
import type { FlyMachineRecord } from '../anywhere/fly/machine-store.js';
import { listFlyMachines, removeFlyMachine } from '../anywhere/fly/machine-store.js';
import { destroyFlyVm, loadFlyApi } from '../anywhere/fly/provision.js';
import { removeLink } from '../anywhere/link-store.js';
import { emitActivityEntry } from '../activity-logger.js';
import { getNativeCodexAuthPath } from '../codex-auth.js';
import { loadConfig } from '../config.js';
import { listLinkedConversations } from '../overdeck/linked-conversations.js';
import type { FlyApiClient } from './fly-api.js';
import { FlyApiError, flyTokenRejectedMessage, isFlyAuthError } from './fly-api.js';
import { listActiveRemoteAgentStates, REMOTE_HOST_HEARTBEAT_PATH } from './remote-agents.js';
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
  /** Environments hosting a linked work agent that is `starting` or `running` (PAN-4734 FR-11). */
  activeLinkedAgentEnvironmentIds: () => Set<string>;
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
  activeLinkedAgentEnvironmentIds: () => new Set(listActiveRemoteAgentStates()
    .filter((state) => state.linked === true && state.environmentId)
    .map((state) => state.environmentId!)),
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
      lines.push(isFlyAuthError(error)
        ? `failed to refresh host heartbeat on ${record.label}: ${flyTokenRejectedMessage(error)}`
        : `failed to refresh host heartbeat on ${record.label}: ${(error as Error).message}`);
    }
  }
  return lines;
}

/**
 * Why a linked record should go now, or null to keep it. Throws only a
 * rejected Fly token (PAN-4748); any other indeterminate API answer keeps it.
 */
async function reasonToRemove(
  record: FlyMachineRecord,
  api: LoopApi,
  deps: FlyMachineLoopDeps,
  idleMs: number,
  conversations: LinkedConversationActivity[],
  busy: Set<string>,
): Promise<string | null> {
  try {
    const machine = await api.getMachine(record.appName, record.machineId);
    if (GONE_STATES.has(machine.state)) return `machine ${machine.state}`;
  } catch (error) {
    if (error instanceof FlyApiError && error.statusCode === 404) return 'machine gone (404)';
    if (isFlyAuthError(error)) throw error;
    return null;
  }

  // A working linked agent's machine belongs to the reap until the hand-off (D-8).
  if (record.environmentId && busy.has(record.environmentId)) {
    idleSince.delete(record.id);
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

/**
 * Destroy a Fly machine (an already-gone one counts as destroyed), then
 * remove its link and forget its record. A failed destroy keeps the link and
 * the record so the next sweep retries. The sweep and the reap (PAN-4734
 * FR-12) both remove machines through here.
 */
export async function destroyAndForgetFlyMachine(
  record: FlyMachineRecord,
  reason: string,
  overrides: Partial<FlyMachineLoopDeps> = {},
  loadedApi?: LoopApi,
): Promise<{ destroyed: boolean; line: string }> {
  const deps = { ...defaultDeps, ...overrides };
  try {
    await destroyFlyVm(record.appName, record.machineId, { api: loadedApi ?? await deps.api() });
  } catch (error) {
    const detail = isFlyAuthError(error) ? flyTokenRejectedMessage(error) : (error as Error).message;
    return { destroyed: false, line: `could not destroy ${record.label} (${reason}): ${detail}; will retry` };
  }
  if (record.linkId !== null) await deps.removeLink(record.linkId);
  await deps.removeRecord(record.id);
  idleSince.delete(record.id);
  deps.activity(`Destroyed Fly machine ${record.label}: ${reason}`, { machineId: record.machineId, appName: record.appName, linkId: record.linkId, reason });
  return { destroyed: true, line: `destroyed ${record.label}: ${reason}` };
}

/** FR-16: destroy, unlink and forget Fly machines that are gone, idle, or never finished provisioning. */
export async function sweepFlyMachines(overrides: Partial<FlyMachineLoopDeps> = {}): Promise<string[]> {
  const deps = { ...defaultDeps, ...overrides };
  const records = await deps.listRecords();
  if (records.length === 0) return [];
  const api = await deps.api();
  const idleMs = Math.max(0, await deps.idleMinutes()) * 60_000;
  const conversations = idleMs > 0 ? deps.listConversations() : [];
  const busy = deps.activeLinkedAgentEnvironmentIds();
  const lines: string[] = [];

  for (const record of records) {
    let reason: string | null;
    if (record.linkId === null) {
      reason = deps.now() - Date.parse(record.createdAt) >= UNLINKED_LIMIT_MS ? 'provisioning never linked it' : null;
    } else {
      try {
        reason = await reasonToRemove(record, api, deps, idleMs, conversations, busy);
      } catch (error) {
        if (!isFlyAuthError(error)) throw error;
        lines.push(`could not check ${record.label}: ${flyTokenRejectedMessage(error)}`);
        continue;
      }
    }
    if (reason === null) continue;
    lines.push((await destroyAndForgetFlyMachine(record, reason, deps, api)).line);
  }
  return lines;
}

export interface FlyCodexSyncDeps {
  listRecords: () => Promise<FlyMachineRecord[]>;
  /** Called only when at least one record is Codex-ready (NFR-1). */
  api: () => Promise<Pick<FlyApiClient, 'execCommand'>>;
  /** Home's native Codex `auth.json`, or null when it does not exist. */
  readHomeAuth: () => Promise<string | null>;
  writeHomeAuth: (raw: string) => Promise<void>;
  activity: (message: string, details: Record<string, unknown>) => void;
}

async function readNativeCodexAuth(): Promise<string | null> {
  try {
    return await readFile(getNativeCodexAuthPath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const defaultCodexSyncDeps: FlyCodexSyncDeps = {
  listRecords: listFlyMachines,
  api: loadFlyApi,
  readHomeAuth: readNativeCodexAuth,
  writeHomeAuth: (raw) => writeHomeCodexAuth(raw),
  activity: defaultDeps.activity,
};

/** FR-10: newest refresh wins between home's Codex sign-in and each Codex-ready Fly machine's. */
export async function syncFlyCodexAuth(overrides: Partial<FlyCodexSyncDeps> = {}): Promise<string[]> {
  const deps = { ...defaultCodexSyncDeps, ...overrides };
  const targets = (await deps.listRecords()).filter((record) => record.linkId !== null && record.codexAuthPath !== null);
  if (targets.length === 0) return [];
  const api = await deps.api();
  const homeRaw = await deps.readHomeAuth();
  let home = homeRaw === null ? null : parseCodexAuthSnapshot(homeRaw);
  const lines: string[] = [];

  for (const record of targets) {
    const path = record.codexAuthPath!;
    const exec = (command: string, timeoutSeconds: number) =>
      api.execCommand(record.appName, record.machineId, ['/bin/sh', '-c', command], timeoutSeconds);
    const read = await readVmCodexAuth(exec, path);
    if (read.state === 'indeterminate') {
      lines.push(read.tokenRejected
        ? `Codex sign-in sync skipped on ${record.label}: ${flyTokenRejectedMessage(read.tokenRejected)}`
        : `Codex sign-in sync skipped on ${record.label}: the Fly machine did not answer`);
      continue;
    }
    const vm = read.state === 'present' ? parseCodexAuthSnapshot(read.raw) : null;
    const action = decideCodexAuthSync(home, vm);
    try {
      if (action === 'push') {
        await pushVmCodexAuth(exec, path, home!.raw);
        lines.push(`Codex sign-in copied to ${record.label}`);
      } else if (action === 'pull') {
        // Home may have refreshed or signed in again since this pass read it; decide again on a
        // fresh read so an older VM copy never overwrites a newer home sign-in.
        const freshRaw = await deps.readHomeAuth();
        const fresh = freshRaw === null ? null : parseCodexAuthSnapshot(freshRaw);
        if (decideCodexAuthSync(fresh, vm) !== 'pull') {
          home = fresh;
          lines.push(`Codex sign-in sync skipped on ${record.label}: this machine's sign-in changed during the pass`);
          continue;
        }
        await deps.writeHomeAuth(vm!.raw);
        home = parseCodexAuthSnapshot(vm!.raw);
        deps.activity(`Codex sign-in refreshed on Fly machine ${record.label} copied home`, { machineId: record.machineId, appName: record.appName, linkId: record.linkId });
        lines.push(`Codex sign-in refreshed on ${record.label} copied home`);
      }
    } catch (error) {
      // pushVmCodexAuth names the path and exit code only; a home write names the local path.
      lines.push(`failed to ${action === 'push' ? 'copy the Codex sign-in to' : 'copy the Codex sign-in home from'} ${record.label}: ${(error as Error).message}`);
    }
  }
  return lines;
}
