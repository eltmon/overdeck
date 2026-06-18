import { getAllActiveQueues } from '../../../lib/overdeck/merge-sync.js';

export type MergeTriggerHandler = (issueId: string) => Promise<unknown>;

let mergeTriggerHandler: MergeTriggerHandler | null = null;

export function setMergeQueueTriggerHandler(handler: MergeTriggerHandler): void {
  mergeTriggerHandler = handler;
}

export async function resumeQueuedMerges(): Promise<void> {
  if (!mergeTriggerHandler) {
    console.warn('[overdeck] Merge queue resume skipped: trigger handler not registered');
    return;
  }

  const queues = getAllActiveQueues();
  const resumableIssues = queues
    .filter(queue => !queue.current && queue.queue.length > 0)
    .map(queue => queue.queue[0]!)
    .filter((issueId): issueId is string => Boolean(issueId));

  for (const issueId of resumableIssues) {
    console.log(`[overdeck] Resuming queued merge for ${issueId}`);
    mergeTriggerHandler(issueId).catch((err: any) => {
      console.error(`[overdeck] Failed to resume queued merge for ${issueId}: ${err.message}`);
    });
  }
}
