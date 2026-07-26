import { resolveCanonicalReviewStatus } from './review-status-source.js';

interface LifecycleEntry {
  issueId: string;
  projectPath: string;
  sourceBranch: string;
  running: boolean;
}

const queue = new Map<string, LifecycleEntry>();
let workerPromise: Promise<void> | null = null;

function nextEntry(): LifecycleEntry | null {
  return [...queue.values()].find((entry) => !entry.running) ?? null;
}

async function drainQueue(): Promise<void> {
  for (let entry = nextEntry(); entry; entry = nextEntry()) {
    entry.running = true;
    const status = resolveCanonicalReviewStatus(entry.issueId);
    if (!status.available || status.status?.mergeStatus !== 'merged'
      || status.status.mergeStep !== 'post-merge-cleanup') {
      queue.delete(entry.issueId);
      continue;
    }
    try {
      const { postMergeLifecycle } = await import('./merge-agent.js');
      await postMergeLifecycle(entry.issueId, entry.projectPath, entry.sourceBranch, { skipDeploy: true });
      console.log(`[deacon] Completed pending post-merge lifecycle for ${entry.issueId}`);
    } catch (error) {
      console.warn(`[deacon] Pending post-merge lifecycle retry failed for ${entry.issueId}: ${error}`);
    } finally {
      queue.delete(entry.issueId);
    }
  }
}

function startWorker(): void {
  if (workerPromise || !nextEntry()) return;
  workerPromise = drainQueue().finally(() => {
    workerPromise = null;
    if (nextEntry()) startWorker();
  });
}

export function enqueuePostMergeLifecycle(
  issueId: string,
  projectPath: string,
  sourceBranch: string,
): string | null {
  const normalizedIssueId = issueId.trim().toUpperCase();
  if (!normalizedIssueId || queue.has(normalizedIssueId)) return null;
  queue.set(normalizedIssueId, {
    issueId: normalizedIssueId,
    projectPath,
    sourceBranch,
    running: false,
  });
  startWorker();
  return `Queued pending post-merge lifecycle for ${normalizedIssueId}`;
}

export async function waitForPostMergeLifecycleIdleForTests(): Promise<void> {
  while (workerPromise) await workerPromise;
}

export async function resetPostMergeLifecycleWorkerForTests(): Promise<void> {
  await waitForPostMergeLifecycleIdleForTests();
  queue.clear();
}
