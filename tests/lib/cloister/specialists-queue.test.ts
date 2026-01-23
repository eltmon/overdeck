/**
 * Tests for specialists.ts queue functions - PAN-74
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  wakeSpecialistOrQueue,
  submitToSpecialistQueue,
  checkSpecialistQueue,
  getNextSpecialistTask,
  completeSpecialistTask,
  isRunning,
  isIdleAtPrompt,
} from '../../../src/lib/cloister/specialists.js';
import { clearHook } from '../../../src/lib/hooks.js';

// Mock the specialist state checking functions
vi.mock('../../../src/lib/cloister/specialists.js', async () => {
  const actual = await vi.importActual('../../../src/lib/cloister/specialists.js');
  return {
    ...actual,
    isRunning: vi.fn(),
    isIdleAtPrompt: vi.fn(),
    wakeSpecialistWithTask: vi.fn(),
  };
});

describe('wakeSpecialistOrQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up test queues
    clearHook('test-agent');
    clearHook('review-agent');
    clearHook('merge-agent');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should wake specialist directly when not running', async () => {
    const { isRunning, wakeSpecialistWithTask } = await import('../../../src/lib/cloister/specialists.js');

    vi.mocked(isRunning).mockResolvedValue(false);
    vi.mocked(wakeSpecialistWithTask).mockResolvedValue({
      success: true,
      message: 'Specialist woken',
      tmuxSession: 'test-agent',
      wasAlreadyRunning: false,
    });

    const result = await wakeSpecialistOrQueue('test-agent', {
      issueId: 'PAN-74',
      workspace: '/test/workspace',
    });

    expect(result.success).toBe(true);
    expect(result.queued).toBe(false);
    expect(wakeSpecialistWithTask).toHaveBeenCalledWith('test-agent', {
      issueId: 'PAN-74',
      workspace: '/test/workspace',
    });
  });

  it('should wake specialist directly when running and idle', async () => {
    const { isRunning, isIdleAtPrompt, wakeSpecialistWithTask } = await import('../../../src/lib/cloister/specialists.js');

    vi.mocked(isRunning).mockResolvedValue(true);
    vi.mocked(isIdleAtPrompt).mockResolvedValue(true);
    vi.mocked(wakeSpecialistWithTask).mockResolvedValue({
      success: true,
      message: 'Task sent to specialist',
      tmuxSession: 'test-agent',
      wasAlreadyRunning: true,
    });

    const result = await wakeSpecialistOrQueue('test-agent', {
      issueId: 'PAN-74',
      workspace: '/test/workspace',
    });

    expect(result.success).toBe(true);
    expect(result.queued).toBe(false);
    expect(wakeSpecialistWithTask).toHaveBeenCalled();
  });

  it('should queue task when specialist is running and busy', async () => {
    const { isRunning, isIdleAtPrompt } = await import('../../../src/lib/cloister/specialists.js');

    vi.mocked(isRunning).mockResolvedValue(true);
    vi.mocked(isIdleAtPrompt).mockResolvedValue(false); // Busy!

    const result = await wakeSpecialistOrQueue('test-agent', {
      issueId: 'PAN-74',
      workspace: '/test/workspace',
      prUrl: 'https://github.com/test/repo/pull/123',
    }, {
      priority: 'high',
      source: 'handoff',
    });

    expect(result.success).toBe(true);
    expect(result.queued).toBe(true);
    expect(result.message).toContain('busy');
    expect(result.message).toContain('queued');

    // Verify task was added to queue
    const queue = checkSpecialistQueue('test-agent');
    expect(queue.hasWork).toBe(true);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].payload.issueId).toBe('PAN-74');
  });

  it('should handle wake failure gracefully', async () => {
    const { isRunning, wakeSpecialistWithTask } = await import('../../../src/lib/cloister/specialists.js');

    vi.mocked(isRunning).mockResolvedValue(false);
    vi.mocked(wakeSpecialistWithTask).mockResolvedValue({
      success: false,
      message: 'Failed to wake specialist',
      tmuxSession: 'test-agent',
      wasAlreadyRunning: false,
      error: 'Test error',
    });

    const result = await wakeSpecialistOrQueue('test-agent', {
      issueId: 'PAN-74',
    });

    expect(result.success).toBe(false);
    expect(result.queued).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('submitToSpecialistQueue', () => {
  beforeEach(() => {
    clearHook('test-agent');
  });

  it('should submit task with all fields', () => {
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
    expect(item.payload.workspace).toBe('/test/workspace');
    expect(item.payload.branch).toBe('feature/pan-74');
    expect(item.payload.prUrl).toBe('https://github.com/test/repo/pull/74');
    expect(item.payload.context).toBeDefined();
    expect(item.payload.context?.reason).toBe('Code review needed');
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
});

describe('checkSpecialistQueue', () => {
  beforeEach(() => {
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
});
