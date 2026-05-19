import { randomUUID } from 'crypto';
import { readdir, readFile, rename, writeFile } from 'fs/promises';
import type { MemoryIdentity, PendingTurn } from '@panctl/contracts';
import { ensureDir, resolvePendingDir } from './paths.js';
import { getMemoryRollupPendingThreshold } from './settings.js';
import { updateMemoryHealth } from './health.js';

export interface WritePendingTurnResult {
  path: string;
  fileName: string;
}

export interface StatusRollupJob {
  identity: Pick<MemoryIdentity, 'projectId' | 'workspaceId' | 'issueId'>;
  pendingTurns: PendingTurn[];
  threshold: number;
}

export type EnqueueStatusRollup = (job: StatusRollupJob) => Promise<void>;
export type StatusRollupProcessor = (job: StatusRollupJob) => Promise<void>;

export interface StatusRollupTriggerOptions {
  enqueueStatusRollup?: EnqueueStatusRollup;
  loadThreshold?: () => number | Promise<number>;
  triggerRollup?: boolean;
}

export type StatusRollupTriggerResult =
  | { status: 'below-threshold'; pendingCount: number; threshold: number }
  | { status: 'triggered'; pendingCount: number; threshold: number }
  | { status: 'collapsed'; pendingCount: number; threshold: number };

let configuredStatusRollupEnqueuer: EnqueueStatusRollup | undefined;
let configuredStatusRollupProcessor: StatusRollupProcessor | undefined;
const inFlightRollups = new Set<string>();

export function setStatusRollupEnqueuer(enqueue: EnqueueStatusRollup | undefined): () => void {
  const previous = configuredStatusRollupEnqueuer;
  configuredStatusRollupEnqueuer = enqueue;
  return () => {
    configuredStatusRollupEnqueuer = previous;
  };
}

export function setStatusRollupProcessor(processor: StatusRollupProcessor | undefined): () => void {
  const previous = configuredStatusRollupProcessor;
  configuredStatusRollupProcessor = processor;
  return () => {
    configuredStatusRollupProcessor = previous;
  };
}

export async function writePendingTurn(turn: PendingTurn, options: StatusRollupTriggerOptions = {}): Promise<WritePendingTurnResult> {
  const dir = resolvePendingDir(turn.identity.projectId, turn.identity.issueId);
  await ensureDir(dir);

  const fileName = pendingTurnFileName(turn);
  const path = `${dir}/${fileName}`;

  try {
    await readFile(path, 'utf8');
    return { path, fileName };
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
  }

  const tempPath = `${dir}/.${fileName}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(turn, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
  if (options.triggerRollup !== false) await maybeTriggerStatusRollup(turn.identity, options);

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
  return turns.sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    const sessionDiff = a.identity.sessionId.localeCompare(b.identity.sessionId);
    if (sessionDiff !== 0) return sessionDiff;
    return a.fromOffset - b.fromOffset || a.toOffset - b.toOffset;
  });
}

export function pendingTurnFileName(turn: Pick<PendingTurn, 'identity' | 'fromOffset' | 'toOffset'>): string {
  return `${safeFileSegment(turn.identity.sessionId)}_${turn.fromOffset}_${turn.toOffset}.json`;
}

async function enqueueStatusRollupEvent(job: StatusRollupJob): Promise<void> {
  if (configuredStatusRollupProcessor) {
    await configuredStatusRollupProcessor(job);
    return;
  }

  const { initEventStore } = await import('../../dashboard/server/event-store.js');
  const { synthesizeStatusRollup, commitStatusRollup } = await import('./rollup.js');
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

  const identity = job.pendingTurns[0]?.identity;
  const result = await synthesizeStatusRollup({
    projectId: job.identity.projectId,
    issueId: job.identity.issueId,
    pendingTurns: job.pendingTurns,
    identity,
  });
  if (result.status !== 'synthesized') {
    if (identity) {
      await updateMemoryHealth(identity, {
        status: result.status === 'skipped' ? 'degraded' : 'failing',
        reason: result.reason,
        success: false,
      });
    }
    return;
  }

  await commitStatusRollup({
    identity: job.identity,
    status: result.memoryStatus,
    pendingTurns: job.pendingTurns,
  });
}

async function loadThreshold(options: StatusRollupTriggerOptions): Promise<number> {
  const threshold = options.loadThreshold ? await options.loadThreshold() : await getMemoryRollupPendingThreshold();
  return Number.isInteger(threshold) && threshold > 0 ? threshold : 4;
}

function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
