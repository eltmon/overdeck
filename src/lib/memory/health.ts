import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { MemoryIdentity } from '@panctl/contracts';
import { ensureParentDir, resolveIssueMemoryRoot } from './paths.js';

export type MemoryHealthStatus = 'healthy' | 'degraded' | 'failing';

export interface MemoryHealthSnapshot {
  status: MemoryHealthStatus;
  last_success: string | null;
  last_failure: string | null;
  extractions_attempted: number;
  extractions_succeeded: number;
  failed_by_reason: Record<string, number>;
}

export interface MemoryHealthUpdate {
  status: MemoryHealthStatus;
  reason?: string;
  success?: boolean;
}

const EMPTY_HEALTH: MemoryHealthSnapshot = {
  status: 'healthy',
  last_success: null,
  last_failure: null,
  extractions_attempted: 0,
  extractions_succeeded: 0,
  failed_by_reason: {},
};

export async function updateMemoryHealth(identity: MemoryIdentity, update: MemoryHealthUpdate): Promise<void> {
  const path = getMemoryHealthPath(identity);
  const current = await readMemoryHealth(path);
  const now = new Date().toISOString();
  const next: MemoryHealthSnapshot = {
    ...current,
    status: update.status,
    extractions_attempted: current.extractions_attempted + 1,
    extractions_succeeded: current.extractions_succeeded + (update.success ? 1 : 0),
    last_success: update.success ? now : current.last_success,
    last_failure: update.success ? current.last_failure : now,
    failed_by_reason: update.success || !update.reason
      ? current.failed_by_reason
      : {
          ...current.failed_by_reason,
          [update.reason]: (current.failed_by_reason[update.reason] ?? 0) + 1,
        },
  };

  await ensureParentDir(path);
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function getMemoryHealthPath(identity: Pick<MemoryIdentity, 'projectId' | 'issueId'>): string {
  return join(resolveIssueMemoryRoot(identity.projectId, identity.issueId), 'health.json');
}

async function readMemoryHealth(path: string): Promise<MemoryHealthSnapshot> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code === 'ENOENT') return { ...EMPTY_HEALTH, failed_by_reason: {} };
    throw error;
  }

  return { ...EMPTY_HEALTH, ...JSON.parse(raw) as Partial<MemoryHealthSnapshot> };
}
