import { randomUUID } from 'crypto';
import { readdir, readFile, rename, writeFile } from 'fs/promises';
import type { MemoryIdentity, PendingTurn } from '@panctl/contracts';
import { ensureDir, resolvePendingDir } from './paths.js';
import { getMemoryRollupPendingThreshold } from './settings.js';

export interface WritePendingTurnResult {
  path: string;
  fileName: string;
}

export interface StatusRollupJob {
  identity: Pick<MemoryIdentity, 'projectId' | 'workspaceId' | 'issueId'>;
  pendingTurns: PendingTurn[];
  threshold: number;
}

export type EnqueueStatusRollup = (job: StatusRollupJob) => void | Promise<void>;

export interface StatusRollupTriggerOptions {
  enqueueStatusRollup?: EnqueueStatusRollup;
  loadThreshold?: () => number | Promise<number>;
}

export type StatusRollupTriggerResult =
  | { status: 'below-threshold'; pendingCount: number; threshold: number }
  | { status: 'triggered'; pendingCount: number; threshold: number }
  | { status: 'collapsed'; pendingCount: number; threshold: number };

let configuredStatusRollupEnqueuer: EnqueueStatusRollup | undefined;
const inFlightRollups = new Set<string>();

export function setStatusRollupEnqueuer(enqueue: EnqueueStatusRollup | undefined): () => void {
  const previous = configuredStatusRollupEnqueuer;
  configuredStatusRollupEnqueuer = enqueue;
  return () => {
    configuredStatusRollupEnqueuer = previous;
  };
}

export async function writePendingTurn(turn: PendingTurn, options: StatusRollupTriggerOptions = {}): Promise<WritePendingTurnResult> {
  const dir = resolvePendingDir(turn.identity.projectId, turn.identity.issueId);
  await ensureDir(dir);

  const fileName = pendingTurnFileName(turn);
  const path = `${dir}/${fileName}`;
  const tempPath = `${dir}/.${fileName}.${process.pid}.${randomUUID()}.tmp`;

  await writeFile(tempPath, `${JSON.stringify(turn, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
  await maybeTriggerStatusRollup(turn.identity, options);

  return { path, fileName };
}

export async function maybeTriggerStatusRollup(
  identity: MemoryIdentity,
  options: StatusRollupTriggerOptions = {},
): Promise<StatusRollupTriggerResult> {
  const threshold = await loadThreshold(options);
  const pendingTurns = await readPendingTurns(identity.projectId, identity.issueId);
  const pendingCount = pendingTurns.length;

  if (pendingCount < threshold) return { status: 'below-threshold', pendingCount, threshold };

  const workspaceKey = `${identity.projectId}:${identity.workspaceId}:${identity.issueId}`;
  if (inFlightRollups.has(workspaceKey)) return { status: 'collapsed', pendingCount, threshold };

  const enqueue = options.enqueueStatusRollup ?? configuredStatusRollupEnqueuer ?? enqueueStatusRollupEvent;

  inFlightRollups.add(workspaceKey);
  try {
    await enqueue({
      identity: {
        projectId: identity.projectId,
        workspaceId: identity.workspaceId,
        issueId: identity.issueId,
      },
      pendingTurns,
      threshold,
    });
    return { status: 'triggered', pendingCount, threshold };
  } finally {
    inFlightRollups.delete(workspaceKey);
  }
}

export async function readPendingTurns(projectId: string, issueId: string): Promise<PendingTurn[]> {
  const dir = resolvePendingDir(projectId, issueId);
  const files = (await readdir(dir).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [] as string[];
    throw error;
  }))
    .filter((file) => file.endsWith('.json') && !file.startsWith('.'))
    .sort();

  const turns: PendingTurn[] = [];
  for (const file of files) {
    turns.push(JSON.parse(await readFile(`${dir}/${file}`, 'utf8')) as PendingTurn);
  }
  return turns;
}

export function pendingTurnFileName(turn: Pick<PendingTurn, 'createdAt' | 'identity'>): string {
  const millis = new Date(turn.createdAt).getTime();
  return `${millis}_${safeFileSegment(turn.identity.sessionId)}.json`;
}

async function enqueueStatusRollupEvent(job: StatusRollupJob): Promise<void> {
  const { initEventStore } = await import('../../dashboard/server/event-store.js');
  const store = await initEventStore();
  await store.appendAsync({
    type: 'memory.rollup_triggered',
    timestamp: new Date().toISOString(),
    payload: {
      projectId: job.identity.projectId,
      workspaceId: job.identity.workspaceId,
      issueId: job.identity.issueId,
      pendingTurns: job.pendingTurns,
      threshold: job.threshold,
    },
  });
}

async function loadThreshold(options: StatusRollupTriggerOptions): Promise<number> {
  const threshold = options.loadThreshold ? await options.loadThreshold() : await getMemoryRollupPendingThreshold();
  return Number.isInteger(threshold) && threshold > 0 ? threshold : 4;
}

function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
