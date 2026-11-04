/**
 * Fly machine store (PAN-4652 WI-6).
 *
 * The single read/write door for `${OVERDECK_HOME}/fly-machines.json`: one
 * record per Fly VM this server provisioned as a linked machine — the Fly app,
 * machine id and region, the id of the machine link it carries, the VM's
 * environment id, its `fly-<machineId>` label, the project it was started for,
 * whether Docker came up on it, and where the VM keeps its Codex sign-in when
 * Codex was prepared there (PAN-4296; a record written before that reads as null).
 *
 * The write path copies `ssh/machine-store.ts`: mode 0600, temp file in the same
 * directory then rename, and an in-process write queue. Each read-modify-write
 * also holds a cross-process lock file (`fly-machines.json.lock`): the dashboard
 * adds and patches records while the deacon child removes them, and an
 * in-process queue cannot stop one process overwriting the other's change. Unlike that store, a
 * corrupt file makes every read throw (the loops that count or destroy Fly
 * machines must not act on an empty list that is not really empty), and nothing
 * rewrites it. A change that alters nothing writes nothing. Imports only Node
 * built-ins and `../../paths.js`, so the CLI can load it without the dashboard
 * runtime.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getOverdeckHome } from '../../paths.js';
import { withFileLock } from '../../vault/file-lock.js';

export const FLY_MACHINES_FILENAME = 'fly-machines.json';

export interface FlyMachineRecord {
  /** `randomUUID()`. */
  id: string;
  /** `MachineLink.id`; null while provisioning. */
  linkId: string | null;
  environmentId: string | null;
  machineId: string;
  /** `overdeck-machine-<8 hex>`. */
  machineName: string;
  appName: string;
  region: string;
  /** `fly-<machineId>`. */
  label: string;
  projectKey: string | null;
  docker: boolean;
  /** `$HOME/.codex/auth.json` on the VM when Codex was prepared (PAN-4296); null otherwise. */
  codexAuthPath: string | null;
  createdAt: string;
}

export type FlyMachinePatch = Partial<Omit<FlyMachineRecord, 'id'>>;

interface FlyMachinesFile {
  v: 1;
  machines: FlyMachineRecord[];
}

let writeQueue: Promise<unknown> = Promise.resolve();

export function flyMachinesPath(): string {
  return join(getOverdeckHome(), FLY_MACHINES_FILENAME);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isNullableText = (value: unknown): boolean => value === null || isText(value);

function isRecord(value: unknown): value is FlyMachineRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isText(r.id) &&
    isNullableText(r.linkId) &&
    isNullableText(r.environmentId) &&
    isText(r.machineId) &&
    isText(r.machineName) &&
    isText(r.appName) &&
    isText(r.region) &&
    isText(r.label) &&
    isNullableText(r.projectKey) &&
    typeof r.docker === 'boolean' &&
    (r.codexAuthPath === undefined || isNullableText(r.codexAuthPath)) &&
    typeof r.createdAt === 'string'
  );
}

function parseMachines(raw: string, path: string): FlyMachineRecord[] {
  // A crash can leave a zero-byte file behind (PAN-2623); it holds no records.
  if (raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Fly machine store ${path} is not valid JSON: ${(error as Error).message}`);
  }
  const file = parsed as Partial<FlyMachinesFile> | null;
  if (typeof file !== 'object' || file === null || file.v !== 1 || !Array.isArray(file.machines) || !file.machines.every(isRecord)) {
    throw new Error(`Fly machine store ${path} has an unexpected shape`);
  }
  // Records written before PAN-4296 have no codexAuthPath; callers always see the field.
  return file.machines.map((record) => ({ ...record, codexAuthPath: record.codexAuthPath ?? null }));
}

function readFailure(error: unknown, path: string): never {
  throw new Error(`Cannot read Fly machine store ${path}: ${(error as Error).message}`);
}

/** Fresh read. Absent ⇒ empty; unreadable or corrupt ⇒ throws naming the path. */
async function readMachines(path: string): Promise<FlyMachineRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return readFailure(error, path);
  }
  return parseMachines(raw, path);
}

async function writeMachines(path: string, machines: FlyMachineRecord[]): Promise<void> {
  const home = getOverdeckHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `${FLY_MACHINES_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  const body: FlyMachinesFile = { v: 1, machines };
  try {
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/**
 * Serialize read-modify-write cycles within this process. `machines: null`
 * means nothing changed, so nothing is written. A corrupt file throws before
 * any write.
 */
function mutate<T>(change: (machines: FlyMachineRecord[]) => { machines: FlyMachineRecord[] | null; result: T }): Promise<T> {
  const run = writeQueue.then(async () => {
    const path = flyMachinesPath();
    await mkdir(getOverdeckHome(), { recursive: true, mode: 0o700 });
    return withFileLock(`${path}.lock`, async () => {
      const { machines, result } = change(await readMachines(path));
      if (machines !== null) await writeMachines(path, machines);
      return result;
    });
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Every record, freshly read. A corrupt or unreadable file throws naming the path. */
export async function listFlyMachines(): Promise<FlyMachineRecord[]> {
  return readMachines(flyMachinesPath());
}

/**
 * The number of records; counts toward `remote.max_concurrent_agents`.
 * Synchronous because its caller, `checkRemoteSpendCap`, and that function's
 * callers are synchronous. It reads one small file and spawns nothing. A
 * corrupt file throws, so the cap fails closed.
 */
export function countFlyMachines(): number {
  const path = flyMachinesPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    return readFailure(error, path);
  }
  return parseMachines(raw, path).length;
}

/** The record carrying `linkId`. Never matches a provisional record (`linkId: null`). */
export async function getFlyMachineByLinkId(linkId: string): Promise<FlyMachineRecord | null> {
  if (!linkId) return null;
  return (await listFlyMachines()).find((record) => record.linkId !== null && record.linkId === linkId) ?? null;
}

/** Write a record, replacing any record with the same `id`. */
export async function upsertFlyMachine(record: FlyMachineRecord): Promise<FlyMachineRecord> {
  if (!isRecord(record)) throw new Error('upsertFlyMachine: the record has an unexpected shape');
  const stored = { ...record };
  return mutate((machines) => ({
    machines: [...machines.filter((entry) => entry.id !== stored.id), stored],
    result: stored,
  }));
}

/** Merge `patch` into a record. Returns the updated record, or null when none has that id. */
export async function updateFlyMachine(id: string, patch: FlyMachinePatch): Promise<FlyMachineRecord | null> {
  return mutate((machines) => {
    const index = machines.findIndex((record) => record.id === id);
    if (index === -1) return { machines: null, result: null };
    const updated: FlyMachineRecord = { ...machines[index]!, ...patch, id };
    if (!isRecord(updated)) throw new Error('updateFlyMachine: the patched record has an unexpected shape');
    const next = machines.slice();
    next[index] = updated;
    return { machines: next, result: updated };
  });
}

/** Delete a record by id. Returns the removed record, or null (and writes nothing) when none has that id. */
export async function removeFlyMachine(id: string): Promise<FlyMachineRecord | null> {
  return mutate((machines) => {
    const removed = machines.find((record) => record.id === id) ?? null;
    if (removed === null) return { machines: null, result: null };
    return { machines: machines.filter((record) => record.id !== id), result: removed };
  });
}

/** Test seam: no production caller; tests wait for queued writes to settle. */
export async function _settleFlyMachineWritesForTests(): Promise<void> {
  await writeQueue;
}

/** Test seam: no production caller; tests drop the write queue between cases. */
export function _resetFlyMachineStoreForTests(): void {
  writeQueue = Promise.resolve();
}
