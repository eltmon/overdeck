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
 * Retry strategy:
 * - One immediate retry with 2s delay if the first wake attempt fails.
 * - Falls back to submitToSpecialistQueue after both attempts fail so the
 *   deacon can retry on the next patrol cycle.
 * - testStatus is only set to 'testing' AFTER confirming delivery or queuing.
 * - On total failure (wake + queue submission both throw): sets
 *   testStatus='dispatch_failed' so the deacon orphan detector can recover.
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
      // Attempt 1
      let testResult = await wakeSpecialistOrQueue(
        'test-agent',
        { issueId, workspace, branch },
        { priority: 'normal', source: 'review-passed-auto' },
      );

      // Retry once on failure with 2s delay (handles transient post-reboot tmux issues)
      if (!testResult.success) {
        console.log(
          `[review-status] First wake attempt failed for ${issueId}: ${testResult.message}. Retrying in 2s...`,
        );
        await new Promise((r) => setTimeout(r, 2000));
        testResult = await wakeSpecialistOrQueue(
          'test-agent',
          { issueId, workspace, branch },
          { priority: 'normal', source: 'review-passed-auto-retry' },
        );
      }

      if (testResult.success) {
        // Only set testStatus after confirming success
        setReviewStatus(issueId, { testStatus: 'testing' });
        testTaskDelivered = true;
        console.log(
          `[review-status] Auto-queued test-agent for ${issueId}: ${testResult.queued ? 'queued' : 'woken'} - ${testResult.message}`,
        );
      } else {
        // Both wake attempts failed — submit to queue for deacon retry
        console.error(
          `[review-status] Both wake attempts failed for ${issueId}: ${testResult.message}. Submitting to queue for deacon retry.`,
        );
        submitToSpecialistQueue('test-agent', {
          priority: 'normal',
          source: 'review-passed-delivery-retry',
          issueId,
          workspace,
          branch,
        });
        // Only set testStatus after queue submission succeeds
        setReviewStatus(issueId, { testStatus: 'testing' });
        testTaskDelivered = true;
        console.log(
          `[review-status] Test-agent task queued for ${issueId} after wake failures (deacon will retry)`,
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[review-status] Failed to dispatch test-agent for ${issueId}:`, err);
    // Set dispatch_failed so the deacon orphan detector can detect and retry
    try {
      setReviewStatus(issueId, {
        testStatus: 'dispatch_failed',
        testNotes: `Dispatch failed: ${msg}`,
      });
    } catch (statusErr) {
      // Don't let status update failure mask the original error
      console.error(`[review-status] Failed to set dispatch_failed status for ${issueId}:`, statusErr);
    }
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
