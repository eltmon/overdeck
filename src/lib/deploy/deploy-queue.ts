import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';

export type PendingDeploy = {
  requestedAt: string;
  requestedBy: string[];
  lastReason: string;
  blockedBy: string[];
  deferralCount: number;
  escalated: boolean;
};

type DeployQueueOptions = {
  overdeckHome?: string;
};

type DeployIntent = {
  requestedBy: string;
  reason: string;
  blockedBy: string[];
};

function pendingDeployPath(options: DeployQueueOptions = {}): string {
  return join(options.overdeckHome ?? getOverdeckHome(), 'pending-deploy.json');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPendingDeploy(value: unknown): value is PendingDeploy {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PendingDeploy>;
  return (
    typeof candidate.requestedAt === 'string'
    && isStringArray(candidate.requestedBy)
    && typeof candidate.lastReason === 'string'
    && isStringArray(candidate.blockedBy)
    && Number.isInteger(candidate.deferralCount)
    && candidate.deferralCount! >= 1
    && typeof candidate.escalated === 'boolean'
  );
}

function sortedUnion(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function writePendingDeploy(record: PendingDeploy, options: DeployQueueOptions = {}): void {
  const path = pendingDeployPath(options);
  mkdirSync(options.overdeckHome ?? getOverdeckHome(), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temp, path);
}

export function readPendingDeploy(options: DeployQueueOptions = {}): PendingDeploy | null {
  try {
    const parsed = JSON.parse(readFileSync(pendingDeployPath(options), 'utf8')) as unknown;
    return isPendingDeploy(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function recordDeployIntent(
  intent: DeployIntent,
  options: DeployQueueOptions = {},
): PendingDeploy {
  const existing = readPendingDeploy(options);
  const record: PendingDeploy = existing
    ? {
      ...existing,
      requestedBy: sortedUnion([...existing.requestedBy, intent.requestedBy]),
      lastReason: intent.reason,
      blockedBy: sortedUnion([...existing.blockedBy, ...intent.blockedBy]),
      deferralCount: existing.deferralCount + 1,
    }
    : {
      requestedAt: new Date().toISOString(),
      requestedBy: [intent.requestedBy],
      lastReason: intent.reason,
      blockedBy: sortedUnion(intent.blockedBy),
      deferralCount: 1,
      escalated: false,
    };
  writePendingDeploy(record, options);
  return record;
}

export function clearPendingDeploy(options: DeployQueueOptions = {}): void {
  rmSync(pendingDeployPath(options), { force: true });
}

export function markPendingDeployEscalated(options: DeployQueueOptions = {}): void {
  const existing = readPendingDeploy(options);
  if (!existing) return;
  writePendingDeploy({ ...existing, escalated: true }, options);
}
