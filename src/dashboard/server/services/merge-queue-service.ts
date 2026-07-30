import { getAllActiveQueues } from '../../../lib/overdeck/merge-sync.js';

/** Advance one project's merge queue — drop entries that cannot start, trigger the first that can. */
export type MergeQueueAdvanceHandler = (projectKey: string) => void;

let mergeQueueAdvanceHandler: MergeQueueAdvanceHandler | null = null;

export function setMergeQueueAdvanceHandler(handler: MergeQueueAdvanceHandler): void {
  mergeQueueAdvanceHandler = handler;
}

/**
 * Boot recovery: restart every project queue that holds entries with nothing processing.
 *
 * PAN-3328: this used to hand `queue[0]` straight to `triggerMerge()`, which rejects an
 * issue that is no longer `readyForMerge` before it ever touches the queue. A dead head
 * therefore bounced on every boot and the queue never advanced past it. Going through the
 * shared advance drops those heads instead of stopping on them.
 */
export async function resumeQueuedMerges(): Promise<void> {
  if (!mergeQueueAdvanceHandler) {
    console.warn('[overdeck] Merge queue resume skipped: advance handler not registered');
    return;
  }

  for (const queue of getAllActiveQueues()) {
    if (queue.current || queue.queue.length === 0) continue;
    console.log(`[overdeck] Resuming merge queue for ${queue.projectKey} (${queue.queue.length} queued)`);
    mergeQueueAdvanceHandler(queue.projectKey);
  }
}
