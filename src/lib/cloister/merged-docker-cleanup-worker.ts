import { emitActivityEntrySync } from '../activity-logger.js';

const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 15 * 60_000;

interface CleanupEntry {
  issueId: string;
  attempts: number;
  nextAttemptAt: number;
  running: boolean;
}

const queue = new Map<string, CleanupEntry>();
let workerPromise: Promise<void> | null = null;

function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

function nextEligibleEntry(): CleanupEntry | null {
  const now = Date.now();
  return [...queue.values()].find((entry) => !entry.running && entry.nextAttemptAt <= now) ?? null;
}

function recordSuccess(issueId: string, steps: string[]): void {
  const message = `Removed merged-issue Docker stack/network for ${issueId}: ${steps.join('; ')}`;
  console.log(`[deacon] ${message}`);
  try {
    emitActivityEntrySync({ source: 'cloister', level: 'info', issueId, message: `[deacon] ${message}` });
  } catch (error) {
    console.warn(`[deacon] Could not record merged Docker cleanup activity for ${issueId}: ${error}`);
  }
}

function recordFailure(entry: CleanupEntry, reason: string): void {
  entry.attempts += 1;
  entry.nextAttemptAt = Date.now() + retryDelayMs(entry.attempts);
  entry.running = false;
  console.warn(
    `[deacon] Merged-issue Docker cleanup failed for ${entry.issueId}; ` +
      `retry ${entry.attempts} after ${new Date(entry.nextAttemptAt).toISOString()}: ${reason}`,
  );
}

async function drainQueue(): Promise<void> {
  const { teardownWorkspaceDockerByNamePromise } = await import('../workspace-manager/docker.js');
  for (let entry = nextEligibleEntry(); entry; entry = nextEligibleEntry()) {
    entry.running = true;
    try {
      const result = await teardownWorkspaceDockerByNamePromise(entry.issueId.toLowerCase());
      if (result.networkRemoved) {
        queue.delete(entry.issueId);
        recordSuccess(entry.issueId, result.steps);
      } else {
        recordFailure(entry, result.steps.join('; '));
      }
    } catch (error) {
      recordFailure(entry, error instanceof Error ? error.message : String(error));
    }
  }
}

function startWorker(): void {
  if (workerPromise || !nextEligibleEntry()) return;
  workerPromise = drainQueue()
    .catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      for (const entry of queue.values()) {
        if (!entry.running && entry.nextAttemptAt <= Date.now()) recordFailure(entry, reason);
      }
    })
    .finally(() => {
      workerPromise = null;
      if (nextEligibleEntry()) startWorker();
    });
}

export function enqueueMergedDockerCleanup(issueId: string): string | null {
  const normalizedIssueId = issueId.trim().toUpperCase();
  if (!normalizedIssueId) return null;
  if (!queue.has(normalizedIssueId)) {
    queue.set(normalizedIssueId, {
      issueId: normalizedIssueId,
      attempts: 0,
      nextAttemptAt: 0,
      running: false,
    });
    startWorker();
    return `Queued merged-issue Docker cleanup for ${normalizedIssueId}`;
  }
  startWorker();
  return null;
}

export async function waitForMergedDockerCleanupIdleForTests(): Promise<void> {
  while (workerPromise) await workerPromise;
}

export async function resetMergedDockerCleanupWorkerForTests(): Promise<void> {
  await waitForMergedDockerCleanupIdleForTests();
  queue.clear();
}

export function getMergedDockerCleanupStateForTests(issueId: string): CleanupEntry | null {
  const entry = queue.get(issueId.toUpperCase());
  return entry ? { ...entry } : null;
}
