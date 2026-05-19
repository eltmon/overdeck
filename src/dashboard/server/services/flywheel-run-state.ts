import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Schema } from 'effect';
import { FlywheelRunId, FlywheelStatus } from '@panctl/contracts';
import { getFlywheelActiveRunId } from '../../../lib/database/app-settings.js';

export type FlywheelRunStatus = 'running' | 'complete' | 'aborted';

export interface FlywheelRunStateOptions {
  panopticonHome?: string;
}

export interface FlywheelRunListOptions extends FlywheelRunStateOptions {
  limit?: number;
}

export interface FlywheelCurrentStatusOptions extends FlywheelRunStateOptions {
  activeRunId?: string | null;
}

export interface FlywheelRunSummary {
  id: string;
  startedAt: string;
  status: FlywheelRunStatus;
}

export interface FlywheelRunDetail extends FlywheelRunSummary {
  latest: FlywheelStatus | null;
  paths: {
    latest: string;
    report?: string;
    openedPr?: string;
  };
}

const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus);
const decodeFlywheelRunId = Schema.decodeUnknownSync(FlywheelRunId);
const RUN_ID_PATTERN = /^RUN-(\d+)$/;
const DEFAULT_RUNS_LIMIT = 20;
const MAX_RUNS_LIMIT = 100;
const RUN_SUMMARY_CONCURRENCY = 4;
type FlywheelStatusListener = (status: FlywheelStatus) => void;
const flywheelStatusListeners = new Set<FlywheelStatusListener>();

export function subscribeLatestFlywheelStatus(listener: FlywheelStatusListener): () => void {
  flywheelStatusListeners.add(listener);
  return () => {
    flywheelStatusListeners.delete(listener);
  };
}

function publishLatestFlywheelStatus(status: FlywheelStatus): void {
  for (const listener of flywheelStatusListeners) {
    listener(status);
  }
}

export function parseFlywheelRunId(runId: string): FlywheelRunId {
  return decodeFlywheelRunId(runId);
}

export function isFlywheelRunId(runId: string): runId is FlywheelRunId {
  return RUN_ID_PATTERN.test(runId);
}

function runNumber(runId: string): number {
  const match = RUN_ID_PATTERN.exec(runId);
  return match ? Number(match[1]) : 0;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_RUNS_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_RUNS_LIMIT;
  return Math.min(Math.floor(limit), MAX_RUNS_LIMIT);
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]!);
    }
  }));
  return results;
}

export function getFlywheelHome(options: FlywheelRunStateOptions = {}): string {
  return join(options.panopticonHome ?? process.env['PANOPTICON_HOME'] ?? join(homedir(), '.panopticon'), 'flywheel');
}

export function getFlywheelRunsDir(options: FlywheelRunStateOptions = {}): string {
  return join(getFlywheelHome(options), 'runs');
}

export function getFlywheelRunDir(runId: string, options: FlywheelRunStateOptions = {}): string {
  return join(getFlywheelRunsDir(options), parseFlywheelRunId(runId));
}

export async function nextFlywheelRunId(options: FlywheelRunStateOptions = {}): Promise<FlywheelRunId> {
  const runsDir = getFlywheelRunsDir(options);
  await mkdir(runsDir, { recursive: true });
  const entries = await readdir(runsDir, { withFileTypes: true });
  const maxRunNumber = entries.reduce((max, entry) => {
    if (!entry.isDirectory()) return max;
    const match = RUN_ID_PATTERN.exec(entry.name);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);
  return parseFlywheelRunId(`RUN-${maxRunNumber + 1}`);
}

export async function writeLatestFlywheelStatus(status: FlywheelStatus, options: FlywheelRunStateOptions = {}): Promise<string> {
  const runDir = getFlywheelRunDir(status.runId, options);
  const latestPath = join(runDir, 'latest.json');
  const tmpPath = join(runDir, `.latest.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await mkdir(dirname(latestPath), { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await rename(tmpPath, latestPath);
  publishLatestFlywheelStatus(status);
  return latestPath;
}

export async function readLatestFlywheelStatus(runId: string, options: FlywheelRunStateOptions = {}): Promise<FlywheelStatus | null> {
  const latestPath = join(getFlywheelRunDir(runId, options), 'latest.json');
  try {
    const payload = JSON.parse(await readFile(latestPath, 'utf8')) as unknown;
    return decodeFlywheelStatus(payload);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return false;
    throw error;
  }
}

async function deriveRunStatus(runDir: string): Promise<FlywheelRunStatus> {
  if (await fileExists(join(runDir, 'aborted.json'))) return 'aborted';
  if (await fileExists(join(runDir, 'report.md'))) return 'complete';
  return 'running';
}

async function summarizeRun(runId: string, options: FlywheelRunStateOptions): Promise<FlywheelRunSummary> {
  const runDir = getFlywheelRunDir(runId, options);
  const latest = await readLatestFlywheelStatus(runId, options);
  const status = await deriveRunStatus(runDir);
  return {
    id: runId,
    startedAt: latest?.startedAt ?? '',
    status,
  };
}

export async function readCurrentLatestFlywheelStatus(options: FlywheelCurrentStatusOptions = {}): Promise<FlywheelStatus | null> {
  const activeRunId = options.activeRunId === undefined ? getFlywheelActiveRunId() : options.activeRunId;
  if (!activeRunId || !isFlywheelRunId(activeRunId)) return null;
  const activeRun = await getFlywheelRunDetail(activeRunId, options);
  return activeRun?.status === 'running' ? activeRun.latest : null;
}

function selectLatestRunIds(entries: Dirent[], limit: number): string[] {
  const selected: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isFlywheelRunId(entry.name)) continue;
    selected.push(entry.name);
    selected.sort((a, b) => runNumber(b) - runNumber(a));
    if (selected.length > limit) selected.length = limit;
  }
  return selected;
}

export async function listFlywheelRuns(options: FlywheelRunListOptions = {}): Promise<FlywheelRunSummary[]> {
  const runsDir = getFlywheelRunsDir(options);
  let entries: Dirent[];
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return [];
    throw error;
  }
  const runIds = selectLatestRunIds(entries, normalizeLimit(options.limit));
  const summaries = await mapWithConcurrency(runIds, RUN_SUMMARY_CONCURRENCY, (runId) => summarizeRun(runId, options));
  return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function getFlywheelRunDetail(runId: string, options: FlywheelRunStateOptions = {}): Promise<FlywheelRunDetail | null> {
  const runDir = getFlywheelRunDir(runId, options);
  const latest = await readLatestFlywheelStatus(runId, options);
  if (!latest) return null;
  const status = await deriveRunStatus(runDir);
  const reportPath = join(runDir, 'report.md');
  const openedPrPath = join(runDir, 'opened-pr.json');
  return {
    id: runId,
    startedAt: latest.startedAt,
    status,
    latest,
    paths: {
      latest: join(runDir, 'latest.json'),
      ...((await fileExists(reportPath)) ? { report: reportPath } : {}),
      ...((await fileExists(openedPrPath)) ? { openedPr: openedPrPath } : {}),
    },
  };
}
