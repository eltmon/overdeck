/**
 * Stand-in workers (PAN-4651 D-4651-5): a worker that runs on another machine
 * keeps a local agent directory `~/.overdeck/agents/<localId>/` holding
 * `remote.json` and the owner's reports mirrored into `reports/<seq>.json`, so
 * `pan worker wait` and the parent read it like a local worker.
 *
 * The owner is the authority (NFR-3): `remote.json` records only where the
 * worker runs and the follower's last observation. It is written 0600 through a
 * temp file + rename. A stand-in never has a `state.json`: it is not an agent
 * state row.
 */
import { access, chmod, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { agentsRoot, reportsDir, workerDir } from './ids.js';
import type { WorkerReport } from './report.js';

export interface RemoteStandIn {
  v: 1;
  environmentId: string;
  label: string;
  /** The worker id on the owner. */
  remoteId: string;
  parentId: string | null;
  issueId: string;
  createdAt: string;
  state: 'running' | 'exited' | 'stopped';
  /** The highest owner report `seq` mirrored here. */
  lastSeq: number;
  lastSeenAt: string | null;
  lastAssistantMessage: string | null;
  idleAgeMs: number | null;
  /** Set while the owner cannot be reached; the wait keeps waiting. */
  unreachableSince: string | null;
}

export function remoteStandInPath(localId: string): string {
  return join(workerDir(localId), 'remote.json');
}

export async function writeRemoteStandIn(localId: string, standIn: RemoteStandIn): Promise<void> {
  const target = remoteStandInPath(localId);
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temp, `${JSON.stringify(standIn, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, target);
}

function isStandIn(value: unknown): value is RemoteStandIn {
  const standIn = value as Partial<RemoteStandIn> | null;
  return !!standIn && standIn.v === 1 && typeof standIn.environmentId === 'string' && typeof standIn.remoteId === 'string'
    && typeof standIn.lastSeq === 'number' && (standIn.state === 'running' || standIn.state === 'exited' || standIn.state === 'stopped');
}

/** The stand-in record of a local worker id; null for a local worker or an unreadable file. */
export async function readRemoteStandIn(localId: string): Promise<RemoteStandIn | null> {
  try {
    const parsed = JSON.parse(await readFile(remoteStandInPath(localId), 'utf8')) as unknown;
    return isStandIn(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Every stand-in under `~/.overdeck/agents/`. */
export async function listRemoteStandIns(): Promise<Array<{ localId: string; standIn: RemoteStandIn }>> {
  const names = await readdir(agentsRoot()).catch(() => [] as string[]);
  const found = await Promise.all(names.map(async (localId) => ({ localId, standIn: await readRemoteStandIn(localId) })));
  return found.filter((entry): entry is { localId: string; standIn: RemoteStandIn } => entry.standIn !== null);
}

/**
 * Mirror one owner report into the stand-in, keeping the owner's `seq` and the
 * `pan worker report` file format. An existing file is left alone (the report
 * was mirrored already). The follower is the only writer of a stand-in, one
 * poll at a time; the rename makes each file appear whole.
 */
export async function mirrorRemoteReport(localId: string, report: WorkerReport): Promise<void> {
  const dir = reportsDir(localId);
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${String(report.seq).padStart(4, '0')}.json`);
  const record: WorkerReport = {
    seq: report.seq,
    at: report.at,
    status: report.status,
    body: report.body,
    ...(report.git ? { git: report.git } : {}),
    ...(report.verdict ? { verdict: report.verdict } : {}),
  };
  if (await access(target).then(() => true, () => false)) return;
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}
