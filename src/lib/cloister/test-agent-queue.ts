/**
 * Auto-queue logic for triggering the test-agent after review passes.
 *
 * Uses per-project ephemeral specialists (no global test-agent pool).
 */

import { setReviewStatus } from '../review-status.js';
import { spawnEphemeralSpecialist, submitToSpecialistQueue } from './specialists.js';
import { resolveProjectFromIssue } from '../projects.js';

/**
 * Spawn an ephemeral test specialist for the given issue, then notify
 * the work agent when delivery succeeds.
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
    const resolved = resolveProjectFromIssue(issueId);
    if (!resolved) {
      console.error(`[test-queue] No project configured for ${issueId} — cannot spawn test specialist`);
      setReviewStatus(issueId, {
        testStatus: 'dispatch_failed',
        testNotes: `No project configured for ${issueId}. Add it to projects.yaml.`,
      });
      return;
    }

    const result = await spawnEphemeralSpecialist(resolved.projectKey, 'test-agent', {
      issueId,
      workspace,
      branch,
    });

    if (result.success) {
      setReviewStatus(issueId, { testStatus: 'testing' });
      testTaskDelivered = true;
      console.log(`[test-queue] Spawned test specialist for ${issueId} (${resolved.projectKey})`);
    } else if (result.error === 'specialist_busy') {
      // Specialist is busy with another task — add to queue for deacon to drain
      console.log(`[test-queue] Specialist busy for ${issueId} — queuing for deacon dispatch`);
      submitToSpecialistQueue('test-agent', {
        priority: 'high',
        source: 'test-queue',
        issueId,
        workspace,
        branch,
      });
      setReviewStatus(issueId, { testStatus: 'testing' });
      testTaskDelivered = true; // notify agent that tests are queued
    } else {
      // Non-busy failure — retry once after 2s
      console.log(`[test-queue] First spawn failed for ${issueId}: ${result.message}. Retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));

      const retry = await spawnEphemeralSpecialist(resolved.projectKey, 'test-agent', {
        issueId,
        workspace,
        branch,
      });

      if (retry.success) {
        setReviewStatus(issueId, { testStatus: 'testing' });
        testTaskDelivered = true;
        console.log(`[test-queue] Spawned test specialist for ${issueId} on retry`);
      } else if (retry.error === 'specialist_busy') {
        // Became busy between attempts — queue it
        console.log(`[test-queue] Specialist became busy for ${issueId} — queuing for deacon dispatch`);
        submitToSpecialistQueue('test-agent', {
          priority: 'high',
          source: 'test-queue',
          issueId,
          workspace,
          branch,
        });
        setReviewStatus(issueId, { testStatus: 'testing' });
        testTaskDelivered = true;
      } else {
        console.error(`[test-queue] Both spawn attempts failed for ${issueId}: ${retry.message}`);
        setReviewStatus(issueId, {
          testStatus: 'dispatch_failed',
          testNotes: `Test specialist spawn failed: ${retry.message}`,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[test-queue] Failed to dispatch test specialist for ${issueId}:`, err);
    try {
      setReviewStatus(issueId, {
        testStatus: 'dispatch_failed',
        testNotes: `Dispatch failed: ${msg}`,
      });
    } catch (statusErr) {
      console.error(`[test-queue] Failed to set dispatch_failed status for ${issueId}:`, statusErr);
    }
  }

  // Only notify work agent when test task was successfully delivered
  if (testTaskDelivered) {
    try {
      await notifyAgent(
        `agent-${issueId.toLowerCase()}`,
        `REVIEW PASSED for ${issueId}. Tests have been queued automatically. Do NOT poll or check status — you will be notified when tests complete.`,
      );
    } catch (err) {
      console.log(
        `[test-queue] Could not notify work agent for ${issueId} (may not be running): ${(err as Error).message}`,
      );
    }
  }
}
