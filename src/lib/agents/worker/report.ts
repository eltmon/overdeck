/**
 * Worker reports (PAN-3920 D15).
 *
 * `pan worker report <id>` writes `~/.overdeck/agents/<id>/reports/<seq>.json`
 * as `{ seq, at, status, body }`, where `seq` is 1-based and zero-padded to
 * four digits in the file name. The write is a temp file plus `rename`, so a
 * reader never sees a half-written report. Reports are artifacts: Overdeck
 * never rewrites or deletes them, and they carry no live state.
 *
 * Reporting is deliberately NOT a POST to `/api/agents/:id/work-complete`: that
 * emits the work agent's `resolution_set: done` event, and the directory
 * already derives a worker's `done` from its newest report.
 */
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { reportsDir } from './ids.js';

export const WORKER_REPORT_STATUSES = ['done', 'blocked', 'failed'] as const;
export type WorkerReportStatus = (typeof WORKER_REPORT_STATUSES)[number];

/** Largest report body accepted, in bytes (UTF-8). */
export const MAX_WORKER_REPORT_BYTES = 1024 * 1024;

export interface WorkerReport {
  readonly seq: number;
  readonly at: string;
  readonly status: WorkerReportStatus;
  readonly body: string;
  /** Git facts a gauntlet lane records with its report (PAN-4223 WI-6); absent on worker reports. */
  readonly git?: WorkerReportGit;
  /** A critic or verifier lane's verdict (PAN-4223 D24); absent on every other report. */
  readonly verdict?: WorkerReportVerdict;
}

export const LANE_VERDICTS = ['WOWED', 'IMPRESSED', 'NOT_YET', 'PASS', 'DEFECTS'] as const;
export type LaneVerdict = (typeof LANE_VERDICTS)[number];

export interface WorkerReportVerdict {
  readonly value: LaneVerdict;
  readonly defects: number | null;
  readonly file: string | null;
}

export function isLaneVerdict(value: unknown): value is LaneVerdict {
  return typeof value === 'string' && (LANE_VERDICTS as readonly string[]).includes(value);
}

function isWorkerReportVerdict(value: unknown): value is WorkerReportVerdict {
  if (typeof value !== 'object' || value === null) return false;
  const verdict = value as Record<string, unknown>;
  const defectsOk = verdict.defects === null || (Number.isInteger(verdict.defects) && (verdict.defects as number) >= 0);
  return isLaneVerdict(verdict.value) && defectsOk && (verdict.file === null || typeof verdict.file === 'string');
}

export interface WorkerReportGit {
  readonly head: string;
  readonly branch: string | null;
}

function isWorkerReportGit(value: unknown): value is WorkerReportGit {
  if (typeof value !== 'object' || value === null) return false;
  const git = value as Record<string, unknown>;
  return typeof git.head === 'string' && (git.branch === null || typeof git.branch === 'string');
}

export function isWorkerReportStatus(value: unknown): value is WorkerReportStatus {
  return typeof value === 'string' && (WORKER_REPORT_STATUSES as readonly string[]).includes(value);
}

function reportFileName(seq: number): string {
  return `${String(seq).padStart(4, '0')}.json`;
}

function seqOf(name: string): number | null {
  const match = /^(\d+)\.json$/.exec(name);
  return match ? Number(match[1]) : null;
}

async function reportSeqs(id: string): Promise<number[]> {
  const names = await readdir(reportsDir(id)).catch(() => [] as string[]);
  return names.map(seqOf).filter((seq): seq is number => seq !== null && seq > 0).sort((a, b) => a - b);
}

function parseReport(raw: string): WorkerReport | null {
  try {
    const parsed = JSON.parse(raw) as Partial<WorkerReport>;
    if (typeof parsed.seq !== 'number' || typeof parsed.body !== 'string' || typeof parsed.at !== 'string') return null;
    const report: WorkerReport = {
      seq: parsed.seq,
      at: parsed.at,
      status: isWorkerReportStatus(parsed.status) ? parsed.status : 'done',
      body: parsed.body,
    };
    return {
      ...report,
      ...(isWorkerReportGit(parsed.git) ? { git: { head: parsed.git.head, branch: parsed.git.branch } } : {}),
      ...(isWorkerReportVerdict(parsed.verdict)
        ? { verdict: { value: parsed.verdict.value, defects: parsed.verdict.defects, file: parsed.verdict.file } }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Record a report and return its `seq` (1 + the highest existing). Two
 * concurrent writers cannot overwrite each other: the final `rename` target is
 * claimed with an exclusive create first.
 */
export async function writeWorkerReport(
  id: string,
  report: { body: string; status?: WorkerReportStatus; git?: WorkerReportGit; verdict?: WorkerReportVerdict },
  now: () => Date = () => new Date(),
): Promise<number> {
  if (Buffer.byteLength(report.body, 'utf8') > MAX_WORKER_REPORT_BYTES) {
    throw new Error(`Report body is larger than ${MAX_WORKER_REPORT_BYTES} bytes; write a summary and point at files instead.`);
  }
  const status = report.status ?? 'done';
  if (!isWorkerReportStatus(status)) throw new Error(`Unknown report status: ${String(status)}`);
  const dir = reportsDir(id);
  await mkdir(dir, { recursive: true });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const seqs = await reportSeqs(id);
    // A lost race re-reads the directory, whose listing now includes the other writer's claim.
    const seq = (seqs.at(-1) ?? 0) + 1;
    const target = join(dir, reportFileName(seq));
    try {
      // Claim the sequence number, then fill it through a temp file + rename.
      await writeFile(target, '', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    const temp = `${target}.${process.pid}.tmp`;
    const record: WorkerReport = {
      seq,
      at: now().toISOString(),
      status,
      body: report.body,
      ...(report.git ? { git: { head: report.git.head, branch: report.git.branch } } : {}),
      ...(report.verdict ? { verdict: { value: report.verdict.value, defects: report.verdict.defects, file: report.verdict.file } } : {}),
    };
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(temp, target);
    return seq;
  }
  throw new Error(`Could not claim a report sequence number for ${id}.`);
}

/** Every complete report of a worker, oldest first. */
export async function listWorkerReports(id: string): Promise<WorkerReport[]> {
  const reports: WorkerReport[] = [];
  for (const seq of await reportSeqs(id)) {
    const raw = await readFile(join(reportsDir(id), reportFileName(seq)), 'utf8').catch(() => '');
    // An empty file is a claimed sequence number whose content is still being written.
    const report = raw ? parseReport(raw) : null;
    if (report) reports.push(report);
  }
  return reports;
}

export async function latestWorkerReport(id: string): Promise<WorkerReport | null> {
  return (await listWorkerReports(id)).at(-1) ?? null;
}

/** Mtime (epoch ms) of the newest report file, or null when there is none. */
export async function latestWorkerReportAt(id: string): Promise<number | null> {
  const seqs = await reportSeqs(id);
  const newest = seqs.at(-1);
  if (newest === undefined) return null;
  try {
    const info = await stat(join(reportsDir(id), reportFileName(newest)));
    return info.size > 0 ? info.mtimeMs : null;
  } catch {
    return null;
  }
}
