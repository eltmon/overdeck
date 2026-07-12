import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const BEADS_CUTOVER_MARKER = 'beads-cutover.json';

export interface BeadsCutoverMarker {
  remoteUrl: string;
  remoteDoltHead: string;
  localReconciledHead: string;
  reconcileReport: { path: string; sha256: string };
  completedAt: string;
}

export interface CutoverMarkerValidation {
  valid: boolean;
  marker?: BeadsCutoverMarker;
  reason?: string;
}

const isSha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);

export function parseBeadsCutoverMarker(value: unknown): BeadsCutoverMarker | null {
  if (!value || typeof value !== 'object') return null;
  const marker = value as Partial<BeadsCutoverMarker>;
  if (typeof marker.remoteUrl !== 'string' || marker.remoteUrl.length === 0) return null;
  if (!isSha(marker.remoteDoltHead) || !isSha(marker.localReconciledHead)) return null;
  if (typeof marker.completedAt !== 'string' || !Number.isFinite(Date.parse(marker.completedAt))) return null;
  if (!marker.reconcileReport || typeof marker.reconcileReport.path !== 'string') return null;
  if (!/^[0-9a-f]{64}$/i.test(marker.reconcileReport.sha256 ?? '')) return null;
  return marker as BeadsCutoverMarker;
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export async function writeBeadsCutoverMarker(path: string, marker: BeadsCutoverMarker): Promise<void> {
  const parsed = parseBeadsCutoverMarker(marker);
  if (!parsed) throw new Error('Refusing to write an invalid beads cutover marker');
  await mkdir(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
}

export async function validateBeadsCutoverMarker(
  markerPath: string,
  repoPath: string,
): Promise<CutoverMarkerValidation> {
  if (!existsSync(markerPath)) return { valid: false, reason: `Cutover marker is missing: ${markerPath}` };
  let marker: BeadsCutoverMarker | null;
  try {
    marker = parseBeadsCutoverMarker(JSON.parse(readFileSync(markerPath, 'utf8')));
  } catch {
    marker = null;
  }
  if (!marker) return { valid: false, reason: `Cutover marker is invalid: ${markerPath}` };
  const reportPath = resolve(dirname(markerPath), marker.reconcileReport.path);
  if (!existsSync(reportPath) || sha256File(reportPath) !== marker.reconcileReport.sha256) {
    return { valid: false, reason: `The reconciliation report is missing or its SHA-256 does not match: ${reportPath}` };
  }
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', marker.remoteUrl, 'refs/dolt/data'], {
      cwd: repoPath,
      encoding: 'utf8',
      timeout: 15_000,
    });
    const remoteHead = stdout.trim().split(/\s+/)[0];
    if (remoteHead !== marker.remoteDoltHead) {
      return { valid: false, reason: 'The remote Dolt head no longer matches the reviewed cutover marker; reconciliation must be repeated.' };
    }
  } catch (error) {
    return { valid: false, reason: `The remote Dolt ref could not be verified: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { valid: true, marker };
}
