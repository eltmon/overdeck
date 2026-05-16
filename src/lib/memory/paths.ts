import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { getPanopticonHome } from '../paths.js';

export function resolveMemoryRoot(projectId: string): string {
  return join(getPanopticonHome(), 'memory', projectId);
}

export function resolveIssueMemoryRoot(projectId: string, issueId: string): string {
  return join(resolveMemoryRoot(projectId), issueId);
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
