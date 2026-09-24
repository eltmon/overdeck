/**
 * `worker.json`: a worker's write-once launch facts (PAN-3920 NFR-3). Written
 * once with the `wx` flag after the launch; it never carries live state.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { workerFactsPath } from './ids.js';

export interface WorkerFacts {
  id: string;
  issueId: string;
  parentId: string | null;
  readOnly: boolean;
  cwd: string;
  branch: string | null;
  name: string | null;
  startedAt: string;
}

export async function writeWorkerFacts(facts: WorkerFacts): Promise<void> {
  await writeFile(workerFactsPath(facts.id), `${JSON.stringify(facts, null, 2)}\n`, { flag: 'wx' });
}

/** Read a worker's `worker.json`; null when it is missing or unreadable. */
export async function readWorkerFacts(id: string): Promise<WorkerFacts | null> {
  try {
    return JSON.parse(await readFile(workerFactsPath(id), 'utf8')) as WorkerFacts;
  } catch {
    return null;
  }
}
