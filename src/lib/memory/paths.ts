import { mkdir } from 'fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'path';
import { getPanopticonHome } from '../paths.js';

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

export function assertMemorySafeSegment(value: string, field: string): string {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error(`Invalid memory ${field}`);
  }
  return value;
}

export function resolveMemoryBase(): string {
  return resolve(getPanopticonHome(), 'memory');
}

export function assertUnderMemoryBase(path: string): string {
  const base = resolveMemoryBase();
  const resolved = resolve(path);
  const rel = relative(base, resolved);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return resolved;
  throw new Error('Resolved memory path escapes memory base');
}

export function resolveMemoryRoot(projectId: string): string {
  const path = join(resolveMemoryBase(), assertMemorySafeSegment(projectId, 'projectId'));
  return assertUnderMemoryBase(path);
}

export function resolveIssueMemoryRoot(projectId: string, issueId: string): string {
  const path = join(resolveMemoryRoot(projectId), assertMemorySafeSegment(issueId, 'issueId'));
  return assertUnderMemoryBase(path);
}

export function resolveObservationsFile(projectId: string, issueId: string, date: string | Date | number): string {
  return join(resolveIssueMemoryRoot(projectId, issueId), 'observations', `${dateKey(date)}.jsonl`);
}

export function resolvePendingDir(projectId: string, issueId: string): string {
  return join(resolveIssueMemoryRoot(projectId, issueId), 'pending');
}

export function resolveStatusFile(projectId: string, issueId: string): string {
  return join(resolveIssueMemoryRoot(projectId, issueId), 'status.json');
}

export function resolveArchiveDir(projectId: string, issueId: string): string {
  return join(resolveIssueMemoryRoot(projectId, issueId), 'archive');
}

export function resolveSummariesDir(projectId: string, issueId: string): string {
  return join(resolveIssueMemoryRoot(projectId, issueId), 'summaries');
}

export function resolveRagRunsFile(projectId: string, issueId: string, date: string | Date | number): string {
  return join(resolveIssueMemoryRoot(projectId, issueId), 'rag-runs', `${dateKey(date)}.jsonl`);
}

export function resolveCheckpointFile(workspacePath: string): string {
  return join(workspacePath, '.pan', 'memory-checkpoint.json');
}

export function resolveFtsDbPath(projectId: string): string {
  return join(resolveMemoryRoot(projectId), 'memory-search.db');
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function ensureParentDir(path: string): Promise<void> {
  await ensureDir(dirname(path));
}

function dateKey(date: string | Date | number): string {
  if (typeof date === 'string') return date.slice(0, 10);
  return new Date(date).toISOString().slice(0, 10);
}
