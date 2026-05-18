import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Schema } from 'effect';
import { FlywheelStatus } from '@panctl/contracts';

export type FlywheelRunStatus = 'running' | 'complete' | 'aborted';

export interface FlywheelRunStateOptions {
  panopticonHome?: string;
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
const RUN_ID_PATTERN = /^RUN-(\d+)$/;

export function getFlywheelHome(options: FlywheelRunStateOptions = {}): string {
  return join(options.panopticonHome ?? process.env['PANOPTICON_HOME'] ?? join(homedir(), '.panopticon'), 'flywheel');
}

export function getFlywheelRunsDir(options: FlywheelRunStateOptions = {}): string {
  return join(getFlywheelHome(options), 'runs');
}

export function getFlywheelRunDir(runId: string, options: FlywheelRunStateOptions = {}): string {
  return join(getFlywheelRunsDir(options), runId);
}

export async function nextFlywheelRunId(options: FlywheelRunStateOptions = {}): Promise<string> {
  const runsDir = getFlywheelRunsDir(options);
  await mkdir(runsDir, { recursive: true });
  const entries = await readdir(runsDir, { withFileTypes: true });
  const maxRunNumber = entries.reduce((max, entry) => {
    if (!entry.isDirectory()) return max;
    const match = RUN_ID_PATTERN.exec(entry.name);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);
  return `RUN-${maxRunNumber + 1}`;
}

export async function writeLatestFlywheelStatus(status: FlywheelStatus, options: FlywheelRunStateOptions = {}): Promise<string> {
  const runDir = getFlywheelRunDir(status.runId, options);
  const latestPath = join(runDir, 'latest.json');
  const tmpPath = join(runDir, `.latest.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await mkdir(dirname(latestPath), { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await rename(tmpPath, latestPath);
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

export async function listFlywheelRuns(options: FlywheelRunStateOptions = {}): Promise<FlywheelRunSummary[]> {
  const runsDir = getFlywheelRunsDir(options);
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return [];
    throw error;
  }
  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => summarizeRun(entry.name, options)),
  );
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
