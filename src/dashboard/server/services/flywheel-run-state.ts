import type { Dirent } from 'node:fs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Schema } from 'effect';
import { FlywheelRunId, FlywheelStatus } from '@overdeck/contracts';
import {
  getFlywheelActiveRunId,
  isFlywheelGloballyPaused,
  setFlywheelActiveRunId,
  setFlywheelGloballyPaused,
} from '../../../lib/overdeck/control-settings.js';
import { countAgentsByStatusRole } from '../../../lib/overdeck/agents.js';

export type FlywheelRunStatus = 'running' | 'paused' | 'complete' | 'aborted';

export interface FlywheelRunStateOptions {
  overdeckHome?: string;
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

export interface FlywheelLaunchMetadata {
  version: 1;
  runId: string;
  workspace: string;
  briefPath: string;
  briefDisplayPath: string;
}

const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus);
const decodeFlywheelRunId = Schema.decodeUnknownSync(FlywheelRunId);
const RUN_ID_PATTERN = /^RUN-(\d+)$/;
const DEFAULT_RUNS_LIMIT = 20;
const MAX_RUNS_LIMIT = 100;
const RUN_SUMMARY_CONCURRENCY = 4;
type FlywheelStatusSnapshot = FlywheelStatus | null;
type FlywheelStatusListener = (status: FlywheelStatusSnapshot) => void;
const flywheelStatusListeners = new Set<FlywheelStatusListener>();

export function subscribeLatestFlywheelStatus(listener: FlywheelStatusListener): () => void {
  flywheelStatusListeners.add(listener);
  return () => {
    flywheelStatusListeners.delete(listener);
  };
}

function publishLatestFlywheelStatus(status: FlywheelStatusSnapshot): void {
  for (const listener of flywheelStatusListeners) {
    listener(status);
  }
}

export function publishFlywheelStatusCleared(): void {
  publishLatestFlywheelStatus(null);
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
  return join(options.overdeckHome ?? process.env['OVERDECK_HOME'] ?? join(homedir(), '.overdeck'), 'flywheel');
}

export function getFlywheelRunsDir(options: FlywheelRunStateOptions = {}): string {
  return join(getFlywheelHome(options), 'runs');
}

export function getFlywheelRunDir(runId: string, options: FlywheelRunStateOptions = {}): string {
  return join(getFlywheelRunsDir(options), parseFlywheelRunId(runId));
}

// ─── Run cohort (PAN-2006 WI-7: drain-to-quiescence) ──────────────────────────
// A Run commits to draining a frozen cohort snapshotted at start: everything
// in-flight ∪ the auto-pickable issues in the current + next wave. The Run is
// complete when every cohort member reaches a terminal state; issues picked up
// mid-run (e.g. unblockers) do NOT extend the cohort.

/** Persist the run's cohort (issue ids) at run start. */
export function saveRunCohort(runId: string, issueIds: readonly string[], options: FlywheelRunStateOptions = {}): void {
  const dir = getFlywheelRunDir(runId, options);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cohort.json'), JSON.stringify({ issueIds: [...issueIds], snapshotAt: new Date().toISOString() }, null, 2), 'utf-8');
}

/** Load the run's cohort issue ids, or null when no snapshot exists. */
export function loadRunCohort(runId: string, options: FlywheelRunStateOptions = {}): string[] | null {
  const path = join(getFlywheelRunDir(runId, options), 'cohort.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { issueIds?: unknown };
    return Array.isArray(parsed.issueIds) ? parsed.issueIds.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * True when every cohort member is terminal (the Run has drained). Returns false
 * when there is no cohort snapshot or it is empty (nothing to declare drained).
 */
export function isCohortDrained(runId: string, isTerminal: (issueId: string) => boolean, options: FlywheelRunStateOptions = {}): boolean {
  const cohort = loadRunCohort(runId, options);
  if (!cohort || cohort.length === 0) return false;
  return cohort.every((id) => isTerminal(id));
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

async function writeJsonAtomic(path: string, payload: unknown): Promise<string> {
  const tmpPath = join(dirname(path), `.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tmpPath, path);
  return path;
}

export async function writeLatestFlywheelStatus(status: FlywheelStatus, options: FlywheelRunStateOptions = {}): Promise<string> {
  const latestPath = join(getFlywheelRunDir(status.runId, options), 'latest.json');
  await writeJsonAtomic(latestPath, status);
  publishLatestFlywheelStatus(status);
  return latestPath;
}

function decodeLaunchMetadata(payload: unknown): FlywheelLaunchMetadata {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid Flywheel launch metadata');
  const record = payload as Record<string, unknown>;
  if (record.version !== 1) throw new Error('Invalid Flywheel launch metadata version');
  for (const key of ['runId', 'workspace', 'briefPath', 'briefDisplayPath']) {
    if (typeof record[key] !== 'string' || !record[key]) throw new Error(`Invalid Flywheel launch metadata: ${key}`);
  }
  return record as unknown as FlywheelLaunchMetadata;
}

export async function writeFlywheelLaunchMetadata(metadata: FlywheelLaunchMetadata, options: FlywheelRunStateOptions = {}): Promise<string> {
  const runId = parseFlywheelRunId(metadata.runId);
  const launchPath = join(getFlywheelRunDir(runId, options), 'launch.json');
  return writeJsonAtomic(launchPath, { ...metadata, runId });
}

export async function readFlywheelLaunchMetadata(runId: string, options: FlywheelRunStateOptions = {}): Promise<FlywheelLaunchMetadata | null> {
  const launchPath = join(getFlywheelRunDir(runId, options), 'launch.json');
  try {
    return decodeLaunchMetadata(JSON.parse(await readFile(launchPath, 'utf8')) as unknown);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return null;
    throw error;
  }
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

async function deriveRunStatus(runDir: string, runId: string, activeRunId: string | null): Promise<FlywheelRunStatus> {
  if (await fileExists(join(runDir, 'aborted.json'))) return 'aborted';
  if (await fileExists(join(runDir, 'report.md'))) return 'complete';
  // PAN-2108: only the CURRENT active run can be live. A run that is no longer the
  // active run but has no terminal marker was abandoned — its orchestrator died or
  // was killed before writing report.md/aborted.json. It is NOT running; reporting
  // it as such lit the sidebar "live" badge for every stale run forever. Treat an
  // orphaned non-active run as aborted.
  if (activeRunId !== runId) return 'aborted';
  return isFlywheelGloballyPaused() ? 'paused' : 'running';
}

async function summarizeRun(
  runId: string,
  options: FlywheelRunStateOptions,
  activeRunId: string | null,
): Promise<FlywheelRunSummary> {
  const runDir = getFlywheelRunDir(runId, options);
  const latest = await readLatestFlywheelStatus(runId, options);
  const status = await deriveRunStatus(runDir, runId, activeRunId);
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
  return (activeRun?.status === 'running' || activeRun?.status === 'paused') ? activeRun.latest : null;
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
  const activeRunId = getFlywheelActiveRunId();
  const summaries = await mapWithConcurrency(runIds, RUN_SUMMARY_CONCURRENCY, (runId) => summarizeRun(runId, options, activeRunId));
  return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * PAN-1528/PAN-1908: overlay the flywheel capacity gauge from the indexed
 * agents table. This status path must not enumerate state.json files.
 */
async function countLiveWorkAgents(_options: FlywheelRunStateOptions = {}): Promise<number> {
  return countAgentsByStatusRole('running', 'work');
}

function withLiveAgentsActive(latest: FlywheelStatus, liveCount: number): FlywheelStatus {
  if (latest.system.agentsActive === liveCount) return latest;
  return {
    ...latest,
    system: {
      ...latest.system,
      agentsActive: liveCount,
    },
  };
}

export async function getFlywheelRunDetail(runId: string, options: FlywheelCurrentStatusOptions = {}): Promise<FlywheelRunDetail | null> {
  const runDir = getFlywheelRunDir(runId, options);
  const latest = await readLatestFlywheelStatus(runId, options);
  if (!latest) return null;
  const activeRunId = options.activeRunId !== undefined ? options.activeRunId : getFlywheelActiveRunId();
  const status = await deriveRunStatus(runDir, runId, activeRunId);
  const reportPath = join(runDir, 'report.md');
  const openedPrPath = join(runDir, 'opened-pr.json');
  // PAN-1528: overlay the live work-agent count so the field reflects reality
  // rather than the orchestrator's stale initial value.
  const liveCount = await countLiveWorkAgents(options);
  return {
    id: runId,
    startedAt: latest.startedAt,
    status,
    latest: withLiveAgentsActive(latest, liveCount),
    paths: {
      latest: join(runDir, 'latest.json'),
      ...((await fileExists(reportPath)) ? { report: reportPath } : {}),
      ...((await fileExists(openedPrPath)) ? { openedPr: openedPrPath } : {}),
    },
  };
}

// Clear the SQLite "active run" gate and the pause flag, and notify subscribers.
// Exported so callers in CLI and dashboard share a single clearing primitive
// (PAN-1245: gate previously cleared in three different places that drifted).
export function clearFlywheelGate(): void {
  setFlywheelActiveRunId(null);
  setFlywheelGloballyPaused(false);
  publishFlywheelStatusCleared();
}

// Single source of truth for "is a flywheel run live?". Reads the SQLite gate,
// validates it against on-disk run state, and self-heals if the gate points at
// a run that has already ended (report.md / aborted.json present), at a run
// whose state was wiped, or at a malformed value. Both `pan flywheel start`
// and the dashboard Start path consult this — they cannot disagree (PAN-1245).
export async function resolveLiveFlywheelRunId(options: FlywheelRunStateOptions = {}): Promise<string | null> {
  const candidate = getFlywheelActiveRunId();
  if (!candidate) return null;
  if (!isFlywheelRunId(candidate)) {
    clearFlywheelGate();
    return null;
  }
  const latest = await readLatestFlywheelStatus(candidate, options);
  if (!latest) {
    // The gate points at a run with no snapshot on disk — the run dir was
    // wiped or never fully initialized. Treat as dead.
    clearFlywheelGate();
    return null;
  }
  const runDir = getFlywheelRunDir(candidate, options);
  // `candidate` is the active run id (read above), so pass it as activeRunId.
  const status = await deriveRunStatus(runDir, candidate, candidate);
  if (status === 'complete' || status === 'aborted') {
    clearFlywheelGate();
    return null;
  }
  return candidate;
}

// Mark a flywheel run as aborted and clear the gate if it still points at this
// run. Writes `aborted.json` so `deriveRunStatus` reports the run as aborted on
// subsequent reads, mirroring the report.md → complete convention.
export async function abortFlywheelRun(runId: string, options: FlywheelRunStateOptions = {}): Promise<void> {
  const parsed = parseFlywheelRunId(runId);
  const abortedPath = join(getFlywheelRunDir(parsed, options), 'aborted.json');
  await writeJsonAtomic(abortedPath, { runId: parsed, abortedAt: new Date().toISOString() });
  if (getFlywheelActiveRunId() === parsed) {
    clearFlywheelGate();
  }
}
