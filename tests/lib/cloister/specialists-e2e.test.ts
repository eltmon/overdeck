/**
 * E2E Tests for Specialist Agent Workflow
 *
 * Tests the full flow: worker agent → review queue → review-agent → merge queue → merge-agent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  initSpecialistsDirectory,
  submitToSpecialistQueue,
  checkSpecialistQueue,
  completeSpecialistTask,
  getNextSpecialistTask,
  getAllSpecialistStatus,
  type SpecialistType,
} from '../../../src/lib/cloister/specialists.js';

describe.skip('Specialist E2E Workflow', () => {
  const testDir = join(process.cwd(), '.test-specialists');
  let originalPanopticonHome: string | undefined;

  beforeEach(() => {
    // Save original PANOPTICON_HOME
    originalPanopticonHome = process.env.PANOPTICON_HOME;

    // Clean up test directory if it exists
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // Create fresh test directory
    mkdirSync(testDir, { recursive: true });

    // Override PANOPTICON_HOME for testing
    process.env.PANOPTICON_HOME = testDir;

    // Initialize specialists directory
    initSpecialistsDirectory();
  });

  afterEach(() => {
    // Restore original PANOPTICON_HOME
    if (originalPanopticonHome) {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    } else {
      delete process.env.PANOPTICON_HOME;
    }

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Queue System', () => {
    it('should submit task to review queue', () => {
      const task = submitToSpecialistQueue('review-agent', {
        priority: 'normal',
        source: 'agent-test-123',
        prUrl: 'https://github.com/test/repo/pull/42',
        issueId: 'TEST-42',
        workspace: '/test/workspace',
        branch: 'feature/test-42',
        filesChanged: ['src/file1.ts', 'src/file2.ts'],
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.type).toBe('task');
      expect(task.priority).toBe('normal');
      expect(task.source).toBe('agent-test-123');
    });

    it('should retrieve pending tasks from queue', () => {
      // Submit multiple tasks
      submitToSpecialistQueue('review-agent', {
        priority: 'urgent',
        source: 'agent-test-1',
        issueId: 'TEST-1',
        prUrl: 'https://github.com/test/repo/pull/1',
      });

      submitToSpecialistQueue('review-agent', {
        priority: 'normal',
        source: 'agent-test-2',
        issueId: 'TEST-2',
        prUrl: 'https://github.com/test/repo/pull/2',
      });

      const queueStatus = checkSpecialistQueue('review-agent');

      expect(queueStatus.hasWork).toBe(true);
      expect(queueStatus.items.length).toBe(2);
      expect(queueStatus.urgentCount).toBe(1);

      // Urgent items should come first
      expect(queueStatus.items[0].priority).toBe('urgent');
      expect(queueStatus.items[1].priority).toBe('normal');
    });

    it('should get next task from queue', () => {
      submitToSpecialistQueue('review-agent', {
        priority: 'high',
        source: 'agent-test-1',
        issueId: 'TEST-1',
        prUrl: 'https://github.com/test/repo/pull/1',
      });

      const nextTask = getNextSpecialistTask('review-agent');

      expect(nextTask).toBeDefined();
      expect(nextTask?.priority).toBe('high');
      expect(nextTask?.source).toBe('agent-test-1');

      // Task should still be in queue (not removed yet)
      const queueStatus = checkSpecialistQueue('review-agent');
      expect(queueStatus.items.length).toBe(1);
    });

    it('should remove completed task from queue', () => {
      const task = submitToSpecialistQueue('review-agent', {
        priority: 'normal',
        source: 'agent-test-1',
        issueId: 'TEST-1',
        prUrl: 'https://github.com/test/repo/pull/1',
      });

      const removed = completeSpecialistTask('review-agent', task.id);
      expect(removed).toBe(true);

      // Queue should now be empty
      const queueStatus = checkSpecialistQueue('review-agent');
      expect(queueStatus.hasWork).toBe(false);
      expect(queueStatus.items.length).toBe(0);
    });

    it('should handle empty queue gracefully', () => {
      const queueStatus = checkSpecialistQueue('review-agent');

      expect(queueStatus.hasWork).toBe(false);
      expect(queueStatus.items.length).toBe(0);
      expect(queueStatus.urgentCount).toBe(0);

      const nextTask = getNextSpecialistTask('review-agent');
      expect(nextTask).toBeNull();
    });
  });

  describe('Worker → Review → Merge Flow', () => {
    it('should simulate complete workflow', () => {
      // Step 1: Worker agent completes work and submits to review queue
      const reviewTask = submitToSpecialistQueue('review-agent', {
        priority: 'normal',
        source: 'agent-pan-42',
        issueId: 'PAN-42',
        prUrl: 'https://github.com/test/repo/pull/42',
        workspace: '/test/workspace/feature-pan-42',
        branch: 'feature/pan-42',
        filesChanged: ['src/file1.ts', 'src/file2.ts'],
        context: {
          description: 'Add new feature',
          linearUrl: 'https://linear.app/team/issue/PAN-42',
        },
      });

      expect(reviewTask).toBeDefined();

      // Step 2: Review agent wakes and checks queue
      const reviewQueue = checkSpecialistQueue('review-agent');
      expect(reviewQueue.hasWork).toBe(true);
      expect(reviewQueue.items.length).toBe(1);

      const taskToReview = getNextSpecialistTask('review-agent');
      expect(taskToReview).toBeDefined();
      expect(taskToReview?.source).toBe('agent-pan-42');

      // Step 3: Review agent completes review (simulated approval)
      completeSpecialistTask('review-agent', reviewTask.id);

      // Review queue should now be empty
      const reviewQueueAfter = checkSpecialistQueue('review-agent');
      expect(reviewQueueAfter.hasWork).toBe(false);

      // Step 4: Review agent submits approved PR to merge queue
      const mergeTask = submitToSpecialistQueue('merge-agent', {
        priority: 'normal',
        source: 'review-agent',
        issueId: 'PAN-42',
        prUrl: 'https://github.com/test/repo/pull/42',
        workspace: '/test/workspace/feature-pan-42',
        branch: 'feature/pan-42',
        context: {
          reviewResult: 'APPROVED',
          reviewedBy: 'review-agent',
        },
      });

      expect(mergeTask).toBeDefined();

      // Step 5: Merge agent wakes and checks queue
      const mergeQueue = checkSpecialistQueue('merge-agent');
      expect(mergeQueue.hasWork).toBe(true);
      expect(mergeQueue.items.length).toBe(1);

      const taskToMerge = getNextSpecialistTask('merge-agent');
      expect(taskToMerge).toBeDefined();
      expect(taskToMerge?.source).toBe('review-agent');

      // Step 6: Merge agent completes merge
      completeSpecialistTask('merge-agent', mergeTask.id);

      // Merge queue should now be empty
      const mergeQueueAfter = checkSpecialistQueue('merge-agent');
      expect(mergeQueueAfter.hasWork).toBe(false);

      // End-to-end flow complete!
    });

    it('should handle multiple PRs in parallel', () => {
      // Submit multiple PRs to review queue
      const pr1 = submitToSpecialistQueue('review-agent', {
        priority: 'urgent',
        source: 'agent-pan-1',
        issueId: 'PAN-1',
        prUrl: 'https://github.com/test/repo/pull/1',
      });

      const pr2 = submitToSpecialistQueue('review-agent', {
        priority: 'high',
        source: 'agent-pan-2',
        issueId: 'PAN-2',
        prUrl: 'https://github.com/test/repo/pull/2',
      });

      const pr3 = submitToSpecialistQueue('review-agent', {
        priority: 'normal',
        source: 'agent-pan-3',
        issueId: 'PAN-3',
        prUrl: 'https://github.com/test/repo/pull/3',
      });

      // Check queue status
      const queue = checkSpecialistQueue('review-agent');
      expect(queue.items.length).toBe(3);
      expect(queue.urgentCount).toBe(1);

      // Process in priority order
      const task1 = getNextSpecialistTask('review-agent');
      expect(task1?.priority).toBe('urgent');
      expect(task1?.source).toBe('agent-pan-1');

      completeSpecialistTask('review-agent', pr1.id);

      const task2 = getNextSpecialistTask('review-agent');
      expect(task2?.priority).toBe('high');
      expect(task2?.source).toBe('agent-pan-2');

      completeSpecialistTask('review-agent', pr2.id);

      const task3 = getNextSpecialistTask('review-agent');
      expect(task3?.priority).toBe('normal');
      expect(task3?.source).toBe('agent-pan-3');

      completeSpecialistTask('review-agent', pr3.id);

      // Queue should be empty
      const finalQueue = checkSpecialistQueue('review-agent');
      expect(finalQueue.hasWork).toBe(false);
    });

    it('should support changes-requested workflow', () => {
      // Step 1: Submit to review
      const reviewTask = submitToSpecialistQueue('review-agent', {
        priority: 'normal',
        source: 'agent-pan-42',
        issueId: 'PAN-42',
        prUrl: 'https://github.com/test/repo/pull/42',
      });

      // Step 2: Review agent finds issues and requests changes
      completeSpecialistTask('review-agent', reviewTask.id);

      // Review agent does NOT submit to merge queue (changes requested)
      const mergeQueue = checkSpecialistQueue('merge-agent');
      expect(mergeQueue.hasWork).toBe(false);

      // Step 3: Worker agent makes changes and resubmits
      const reviewTask2 = submitToSpecialistQueue('review-agent', {
        priority: 'normal',
        source: 'agent-pan-42',
        issueId: 'PAN-42',
        prUrl: 'https://github.com/test/repo/pull/42',
        context: {
          resubmission: true,
          previousReview: 'CHANGES_REQUESTED',
        },
      });

      expect(reviewTask2).toBeDefined();

      // Step 4: Review agent approves this time
      completeSpecialistTask('review-agent', reviewTask2.id);

      // Now submit to merge queue
      const mergeTask = submitToSpecialistQueue('merge-agent', {
        priority: 'normal',
        source: 'review-agent',
        issueId: 'PAN-42',
        prUrl: 'https://github.com/test/repo/pull/42',
      });

      expect(mergeTask).toBeDefined();

      const mergeQueueAfter = checkSpecialistQueue('merge-agent');
      expect(mergeQueueAfter.hasWork).toBe(true);
    });
  });

  describe('Specialist Status', () => {
    it('should get all specialist statuses', () => {
      const statuses = getAllSpecialistStatus();

      expect(statuses).toBeDefined();
      expect(statuses.length).toBeGreaterThan(0);

      // Should include at least merge-agent and review-agent
      const specialistNames = statuses.map((s) => s.name);
      expect(specialistNames).toContain('merge-agent');
      expect(specialistNames).toContain('review-agent');
      expect(specialistNames).toContain('test-agent');

      // Each status should have required fields
      for (const status of statuses) {
        expect(status).toHaveProperty('name');
        expect(status).toHaveProperty('displayName');
        expect(status).toHaveProperty('description');
        expect(status).toHaveProperty('enabled');
        expect(status).toHaveProperty('state');
        expect(status).toHaveProperty('isRunning');
        expect(status).toHaveProperty('tmuxSession');
      }
    });

    it('should show correct initial state for specialists', () => {
      const statuses = getAllSpecialistStatus();

      for (const status of statuses) {
        // Initially, specialists should be uninitialized (no session)
        expect(status.state).toBe('uninitialized');
        expect(status.isRunning).toBe(false);
        expect(status.sessionId).toBeUndefined();
      }
    });
  });
});
