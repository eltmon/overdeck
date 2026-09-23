/**
 * `pan worker list` source (PAN-3920 W14): every `agent-*-worker-*` directory
 * with its write-once facts and newest report. State is read live from the
 * liveness oracle by the caller; nothing here stores it.
 */
import { readdir } from 'node:fs/promises';

import { agentsRoot, isWorkerId } from './ids.js';
import { latestWorkerReport, type WorkerReport } from './report.js';
import { readWorkerFacts, type WorkerFacts } from './start.js';

export interface WorkerListing {
  readonly id: string;
  readonly facts: WorkerFacts | null;
  readonly latestReport: WorkerReport | null;
}

export async function listWorkers(filter: { issueId?: string; parentId?: string } = {}): Promise<WorkerListing[]> {
  const names = await readdir(agentsRoot()).catch(() => [] as string[]);
  const issue = filter.issueId?.toLowerCase();
  const listings: WorkerListing[] = [];
  for (const id of names.filter(isWorkerId).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (issue && !id.startsWith(`agent-${issue}-worker-`)) continue;
    const facts = await readWorkerFacts(id);
    if (filter.parentId && facts?.parentId?.toLowerCase() !== filter.parentId.toLowerCase()) continue;
    listings.push({ id, facts, latestReport: await latestWorkerReport(id) });
  }
  return listings;
}
