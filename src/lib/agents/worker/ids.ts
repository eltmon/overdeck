/**
 * Worker ids and directories (PAN-3920 D12).
 *
 * A worker id is `agent-<issue-lowercase>-worker-<n>`, which is exactly
 * `runAgentId(issueId, 'worker', String(n))` and passes
 * `isValidAgentDirectoryName`, so `pan sync`'s cleanup keeps the directory.
 * The id is claimed by creating the agent directory without `recursive`: two
 * concurrent `pan worker run` calls can never get the same `n`.
 */
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { getOverdeckHome } from '../../paths.js';

export const WORKER_ID_RE = /^agent-[a-z0-9_-]+-worker-\d+$/;

/** How many ids `allocateWorkerId` tries before giving up. */
export const WORKER_ID_CLAIM_ATTEMPTS = 20;

export function agentsRoot(): string {
  return join(getOverdeckHome(), 'agents');
}

/** `~/.overdeck/agents/<id>` — the directory spawnRun writes state.json and launcher.sh into. */
export function workerDir(id: string): string {
  return join(agentsRoot(), id);
}

/** `~/.overdeck/agents/<id>/reports`, where `pan worker report` writes `<seq>.json`. */
export function reportsDir(id: string): string {
  return join(workerDir(id), 'reports');
}

/** `~/.overdeck/agents/<id>/worker.json`, the write-once launch facts. */
export function workerFactsPath(id: string): string {
  return join(workerDir(id), 'worker.json');
}

export function isWorkerId(id: string): boolean {
  return WORKER_ID_RE.test(id);
}

/** The worker number `n` of `agent-<issue>-worker-<n>`, or null. */
export function workerNumber(id: string): number | null {
  const match = /-worker-(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

function workerPrefix(issueId: string): string {
  return `agent-${issueId.toLowerCase()}-worker-`;
}

/**
 * Claim the next worker id for an issue: `n` = 1 + the highest existing `n`,
 * then `mkdir` without `recursive`. On `EEXIST` (a concurrent claim) try the
 * next number.
 */
export async function allocateWorkerId(issueId: string): Promise<string> {
  const prefix = workerPrefix(issueId);
  const root = agentsRoot();
  await mkdir(root, { recursive: true });
  const names = await readdir(root).catch(() => [] as string[]);
  let highest = 0;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    if (/^\d+$/.test(rest)) highest = Math.max(highest, Number(rest));
  }

  for (let attempt = 1; attempt <= WORKER_ID_CLAIM_ATTEMPTS; attempt += 1) {
    const id = `${prefix}${highest + attempt}`;
    try {
      await mkdir(join(root, id));
      return id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Could not claim a worker id for ${issueId} after ${WORKER_ID_CLAIM_ATTEMPTS} attempts.`);
}
