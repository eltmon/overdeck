/**
 * Auto-queue logic for triggering the test-agent after review passes.
 *
 * Extracted from the POST /api/workspaces/:issueId/review-status handler
 * (PAN-343) so it can be unit-tested independently. The route handler
 * delegates to `autoQueueTestAgentAndNotify`, passing `messageAgent` as
 * the notify callback.
 */

import { setReviewStatus } from '../review-status.js';
import {
  wakeSpecialistOrQueue,
  checkSpecialistQueue,
  submitToSpecialistQueue,
} from './specialists.js';
import type { HookItem } from '../hooks.js';

/**
 * Attempt to wake or queue the test-agent for a given issue, then notify
 * the work agent when delivery succeeds.
 *
 * On wake failure: falls back to submitToSpecialistQueue so the deacon
 * retries on the next patrol cycle. The work-agent notification is gated
 * on successful delivery — if the entire queuing block throws, the agent
 * is NOT notified (testTaskDelivered safety invariant).
 *
 * @param issueId     - Issue identifier (e.g. "PAN-343")
 * @param workspace   - Absolute path to the workspace directory
 * @param branch      - Feature branch name (e.g. "feature/pan-343")
 * @param notifyAgent - Callback that sends a message to the work agent
 */
export async function autoQueueTestAgentAndNotify(
  issueId: string,
  workspace: string,
  branch: string,
  notifyAgent: (agentId: string, msg: string) => Promise<void>,
): Promise<void> {
  let testTaskDelivered = false;

  try {
    // Dedup: skip if test-agent already has this issue queued
    const testQueue = checkSpecialistQueue('test-agent');
    const alreadyQueued = testQueue.items.some(
      (item: HookItem) =>
        item.payload?.issueId?.toLowerCase() === issueId.toLowerCase(),
    );

    if (alreadyQueued) {
      console.log(`[review-status] Test-agent already has ${issueId} queued, skipping`);
      // Refresh testStatus so dashboard doesn't show stale 'pending'
      setReviewStatus(issueId, { testStatus: 'testing' });
      testTaskDelivered = true;
    } else {
      const testResult = await wakeSpecialistOrQueue(
        'test-agent',
        { issueId, workspace, branch },
        { priority: 'normal', source: 'review-passed-auto' },
      );

      if (testResult.success) {
        setReviewStatus(issueId, { testStatus: 'testing' });
        testTaskDelivered = true;
        console.log(
          `[review-status] Auto-queued test-agent for ${issueId}: ${testResult.queued ? 'queued' : 'woken'} - ${testResult.message}`,
        );
      } else {
        // Wake failed — submit to queue so deacon can retry on next patrol cycle
        console.error(
          `[review-status] Test-agent wake failed for ${issueId}: ${testResult.message}. Submitting to queue for deacon retry.`,
        );
        submitToSpecialistQueue('test-agent', {
          priority: 'normal',
          source: 'review-passed-delivery-retry',
          issueId,
          workspace,
          branch,
        });
        setReviewStatus(issueId, { testStatus: 'testing' });
        testTaskDelivered = true;
        console.log(
          `[review-status] Test-agent task queued for ${issueId} after wake failure (deacon will retry)`,
        );
      }
    }
  } catch (err) {
    console.error(`[review-status] Failed to auto-queue test-agent for ${issueId}:`, err);
    // testTaskDelivered stays false — work agent will not be falsely notified
  }

  // Only notify work agent when test task was successfully delivered or queued
  if (testTaskDelivered) {
    try {
      await notifyAgent(
        `agent-${issueId.toLowerCase()}`,
        `REVIEW PASSED for ${issueId}. Tests have been queued automatically. Do NOT poll or check status — you will be notified when tests complete.`,
      );
      console.log(`[review-status] Notified agent-${issueId.toLowerCase()} that review passed`);
    } catch (err) {
      // Agent may not be running — that's fine
      console.log(
        `[review-status] Could not notify work agent for ${issueId} (may not be running): ${(err as Error).message}`,
      );
    }
  }
}
