/**
 * Tests for specialists.ts queue functions - PAN-74
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  submitToSpecialistQueue,
  checkSpecialistQueue,
  getNextSpecialistTask,
  completeSpecialistTask,
} from '../../../src/lib/cloister/specialists.js';
import { clearHook } from '../../../src/lib/hooks.js';

describe('submitToSpecialistQueue', () => {
  beforeEach(() => {
    clearHook('test-agent');
    clearHook('review-agent');
    clearHook('merge-agent');
  });

  afterEach(() => {
    // Clean up to prevent pollution of real queue
    clearHook('test-agent');
    clearHook('review-agent');
    clearHook('merge-agent');
  });

  it('should submit task with all fields in context', () => {
    const item = submitToSpecialistQueue('test-agent', {
      priority: 'urgent',
      source: 'handoff',
      issueId: 'PAN-74',
      workspace: '/test/workspace',
      branch: 'feature/pan-74',
      prUrl: 'https://github.com/test/repo/pull/74',
      context: {
        reason: 'Code review needed',
        targetModel: 'opus',
      },
    });

    expect(item.id).toBeDefined();
    expect(item.type).toBe('task');
    expect(item.priority).toBe('urgent');
    expect(item.source).toBe('handoff');
    expect(item.payload.issueId).toBe('PAN-74');

    // workspace, branch, prUrl are in context, not directly in payload
    expect(item.payload.context).toBeDefined();
    expect(item.payload.context?.workspace).toBe('/test/workspace');
    expect(item.payload.context?.branch).toBe('feature/pan-74');
    expect(item.payload.context?.prUrl).toBe('https://github.com/test/repo/pull/74');
    expect(item.payload.context?.reason).toBe('Code review needed');
    expect(item.payload.context?.targetModel).toBe('opus');
  });

  it('should generate unique IDs for each item', () => {
    const item1 = submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-1',
    });

    const item2 = submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-2',
    });

    expect(item1.id).not.toBe(item2.id);
  });

  it('should handle minimal task fields', () => {
    const item = submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-100',
    });

    expect(item.payload.issueId).toBe('PAN-100');
    expect(item.payload.context).toBeDefined();
  });
});

describe('checkSpecialistQueue', () => {
  beforeEach(() => {
    clearHook('test-agent');
  });

  afterEach(() => {
    clearHook('test-agent');
  });

  it('should return empty queue for specialist with no tasks', () => {
    const queue = checkSpecialistQueue('test-agent');

    expect(queue.hasWork).toBe(false);
    expect(queue.urgentCount).toBe(0);
    expect(queue.items).toHaveLength(0);
  });

  it('should count urgent items correctly', () => {
    submitToSpecialistQueue('test-agent', {
      priority: 'urgent',
      source: 'test',
      issueId: 'PAN-1',
    });
    submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-2',
    });
    submitToSpecialistQueue('test-agent', {
      priority: 'urgent',
      source: 'test',
      issueId: 'PAN-3',
    });

    const queue = checkSpecialistQueue('test-agent');

    expect(queue.hasWork).toBe(true);
    expect(queue.urgentCount).toBe(2);
    expect(queue.items).toHaveLength(3);
  });

  it('should maintain priority order', () => {
    submitToSpecialistQueue('test-agent', {
      priority: 'low',
      source: 'test',
      issueId: 'PAN-1',
    });
    submitToSpecialistQueue('test-agent', {
      priority: 'urgent',
      source: 'test',
      issueId: 'PAN-2',
    });
    submitToSpecialistQueue('test-agent', {
      priority: 'high',
      source: 'test',
      issueId: 'PAN-3',
    });
    submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-4',
    });

    const queue = checkSpecialistQueue('test-agent');

    // Items should be ordered: urgent, high, normal, low
    expect(queue.items[0].priority).toBe('urgent');
    expect(queue.items[1].priority).toBe('high');
    expect(queue.items[2].priority).toBe('normal');
    expect(queue.items[3].priority).toBe('low');
  });
});

describe('getNextSpecialistTask', () => {
  beforeEach(() => {
    clearHook('test-agent');
  });

  afterEach(() => {
    clearHook('test-agent');
  });

  it('should return null for empty queue', () => {
    const task = getNextSpecialistTask('test-agent');
    expect(task).toBeNull();
  });

  it('should return highest priority task', () => {
    submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-1',
    });
    submitToSpecialistQueue('test-agent', {
      priority: 'urgent',
      source: 'test',
      issueId: 'PAN-2',
    });

    const task = getNextSpecialistTask('test-agent');

    expect(task).toBeDefined();
    expect(task!.priority).toBe('urgent');
    expect(task!.payload.issueId).toBe('PAN-2');
  });

  it('should not remove task from queue', () => {
    submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-1',
    });

    const task1 = getNextSpecialistTask('test-agent');
    const task2 = getNextSpecialistTask('test-agent');

    expect(task1).toBeDefined();
    expect(task2).toBeDefined();
    expect(task1!.id).toBe(task2!.id); // Same task
  });
});

describe('completeSpecialistTask', () => {
  beforeEach(() => {
    clearHook('test-agent');
  });

  afterEach(() => {
    clearHook('test-agent');
  });

  it('should remove task from queue', () => {
    const item = submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-1',
    });

    const queue1 = checkSpecialistQueue('test-agent');
    expect(queue1.items).toHaveLength(1);

    const success = completeSpecialistTask('test-agent', item.id);
    expect(success).toBe(true);

    const queue2 = checkSpecialistQueue('test-agent');
    expect(queue2.items).toHaveLength(0);
  });

  it('should return false for non-existent task', () => {
    const success = completeSpecialistTask('test-agent', 'non-existent-id');
    expect(success).toBe(false);
  });

  it('should only remove specified task', () => {
    const item1 = submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-1',
    });
    const item2 = submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-2',
    });

    completeSpecialistTask('test-agent', item1.id);

    const queue = checkSpecialistQueue('test-agent');
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].id).toBe(item2.id);
  });

  it('should handle queue with multiple priorities', () => {
    submitToSpecialistQueue('test-agent', {
      priority: 'urgent',
      source: 'test',
      issueId: 'PAN-1',
    });
    const item2 = submitToSpecialistQueue('test-agent', {
      priority: 'normal',
      source: 'test',
      issueId: 'PAN-2',
    });
    submitToSpecialistQueue('test-agent', {
      priority: 'low',
      source: 'test',
      issueId: 'PAN-3',
    });

    // Remove the middle priority item
    completeSpecialistTask('test-agent', item2.id);

    const queue = checkSpecialistQueue('test-agent');
    expect(queue.items).toHaveLength(2);
    expect(queue.items[0].priority).toBe('urgent');
    expect(queue.items[1].priority).toBe('low');
  });
});
