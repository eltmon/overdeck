/**
 * SSH machine store (PAN-4404 WI-3).
 *
 * The single read/write door for `${OVERDECK_HOME}/ssh-machines.json`: one
 * record per machine this server reaches over SSH — the destination, the id of
 * the machine link it carries, the host's environment id, the forwarded ports,
 * the launch kind and the pid of the running forward. It is a separate file from
 * `machine-links.json` because `upsertLink` rebuilds link records field by field.
 *
 * The write path copies `link-store.ts`: mode 0600, temp file in the same
 * directory then rename, an in-process write queue, and fail-closed parsing — a
 * corrupt file means zero records plus one loud error naming the path, and it is
 * never overwritten. Imports only Node built-ins and `../../paths.js`, so the CLI
 * can load it without the dashboard runtime.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getOverdeckHome } from '../../paths.js';

export const SSH_MACHINES_FILENAME = 'ssh-machines.json';

export interface SshMachineRecord {
  id: string;
  /** Validated destination, as typed. */
  destination: string;
  /** `MachineLink.id`; null only while an add is in progress (D-4404-3 step 5). */
  linkId: string | null;
  /** The host's environment id (from the helper result). */
  environmentId: string;
  localPort: number;
  remotePort: number;
  launch: 'managed' | 'external';
  panPath: string | null;
  forwardPid: number | null;
  addedAt: string;
}

export type SshMachinePatch = Partial<Omit<SshMachineRecord, 'id'>>;

interface SshMachinesFile {
  v: 1;
  machines: SshMachineRecord[];
}

let writeQueue: Promise<unknown> = Promise.resolve();
let lastError: string | null = null;

export function sshMachinesPath(): string {
  return join(getOverdeckHome(), SSH_MACHINES_FILENAME);
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isRecord(value: unknown): value is SshMachineRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' && r.id !== '' &&
    typeof r.destination === 'string' && r.destination !== '' &&
    (r.linkId === null || (typeof r.linkId === 'string' && r.linkId !== '')) &&
    typeof r.environmentId === 'string' && r.environmentId !== '' &&
    isPort(r.localPort) &&
    isPort(r.remotePort) &&
    (r.launch === 'managed' || r.launch === 'external') &&
    (r.panPath === null || typeof r.panPath === 'string') &&
    (r.forwardPid === null || (typeof r.forwardPid === 'number' && Number.isInteger(r.forwardPid) && r.forwardPid > 0)) &&
    typeof r.addedAt === 'string'
  );
}

function parseMachines(raw: string, path: string): SshMachineRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`SSH machine store ${path} is not valid JSON: ${(error as Error).message}`);
  }
  const file = parsed as Partial<SshMachinesFile> | null;
  if (typeof file !== 'object' || file === null || file.v !== 1 || !Array.isArray(file.machines) || !file.machines.every(isRecord)) {
    throw new Error(`SSH machine store ${path} has an unexpected shape`);
  }
  return file.machines;
}

/** Fresh read. Absent ⇒ empty; unreadable or corrupt ⇒ throws naming the path. */
async function readMachines(path: string): Promise<SshMachineRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Cannot read SSH machine store ${path}: ${(error as Error).message}`);
  }
  return parseMachines(raw, path);
}

async function writeMachines(path: string, machines: SshMachineRecord[]): Promise<void> {
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `${SSH_MACHINES_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const body: SshMachinesFile = { v: 1, machines };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  lastError = null;
}

/** Serialize read-modify-write cycles within this process. A corrupt file is never overwritten. */
function mutate<T>(change: (machines: SshMachineRecord[]) => { machines: SshMachineRecord[]; result: T }): Promise<T> {
  const run = writeQueue.then(async () => {
    const path = sshMachinesPath();
    const { machines, result } = change(await readMachines(path));
    await writeMachines(path, machines);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

function reportError(error: Error): void {
  if (lastError === error.message) return;
  lastError = error.message;
  console.error(`[ssh-machines] ${error.message}. No SSH machine is forwarded until the file is repaired.`);
}

/**
 * Every record, freshly read. A corrupt or unreadable file yields zero records
 * and one loud error naming the file (never a permissive parse).
 */
export async function listSshMachines(): Promise<SshMachineRecord[]> {
  try {
    const machines = await readMachines(sshMachinesPath());
    lastError = null;
    return machines;
  } catch (error) {
    reportError(error as Error);
    return [];
  }
}

/** The record carrying `linkId`. Never matches a provisional record (`linkId: null`). */
export async function getSshMachineByLinkId(linkId: string): Promise<SshMachineRecord | null> {
  if (!linkId) return null;
  return (await listSshMachines()).find((record) => record.linkId !== null && record.linkId === linkId) ?? null;
}

/** Write a record, replacing any record with the same `id`. */
export async function upsertSshMachine(record: SshMachineRecord): Promise<SshMachineRecord> {
  if (!isRecord(record)) throw new Error('upsertSshMachine: the record has an unexpected shape');
  const stored = { ...record };
  return mutate((machines) => ({
    machines: [...machines.filter((entry) => entry.id !== stored.id), stored],
    result: stored,
  }));
}

/** Delete a record by id. Returns the removed record, or null when none has that id. */
export async function removeSshMachine(id: string): Promise<SshMachineRecord | null> {
  return mutate((machines) => {
    const removed = machines.find((record) => record.id === id) ?? null;
    return { machines: machines.filter((record) => record.id !== id), result: removed };
  });
}

/** Merge `patch` into a record. Returns the updated record, or null when none has that id. */
export async function updateSshMachine(id: string, patch: SshMachinePatch): Promise<SshMachineRecord | null> {
  return mutate((machines) => {
    const index = machines.findIndex((record) => record.id === id);
    if (index === -1) return { machines, result: null };
    const updated: SshMachineRecord = { ...machines[index]!, ...patch, id };
    if (!isRecord(updated)) throw new Error('updateSshMachine: the patched record has an unexpected shape');
    const next = machines.slice();
    next[index] = updated;
    return { machines: next, result: updated };
  });
}

/** Test-only: wait for queued writes to settle. */
export async function _settleSshMachineWritesForTests(): Promise<void> {
  await writeQueue;
}

/** Test-only: drop the queue and the reported error. */
export function _resetSshMachineStoreForTests(): void {
  writeQueue = Promise.resolve();
  lastError = null;
}
