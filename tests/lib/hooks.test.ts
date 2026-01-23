/**
 * Tests for hooks.ts - PAN-74 queue reordering function
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reorderHookItems, getHook, pushToHook, clearHook } from '../../src/lib/hooks.js';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PANOPTICON_HOME } from '../../src/lib/paths.js';

const TEST_AGENT_ID = 'test-agent-reorder';
const TEST_HOOK_FILE = join(PANOPTICON_HOME, 'hooks', `${TEST_AGENT_ID}.json`);

describe('reorderHookItems', () => {
  beforeEach(() => {
    // Clean up any existing test hook
    if (existsSync(TEST_HOOK_FILE)) {
      unlinkSync(TEST_HOOK_FILE);
    }
  });

  afterEach(() => {
    // Clean up test hook after each test
    if (existsSync(TEST_HOOK_FILE)) {
      unlinkSync(TEST_HOOK_FILE);
    }
  });

  it('should reorder items successfully', () => {
    // Create test items
    pushToHook(TEST_AGENT_ID, {
      type: 'task',
      priority: 'normal',
      source: 'test',
      payload: { message: 'Item 1' },
    });
    pushToHook(TEST_AGENT_ID, {
      type: 'task',
      priority: 'normal',
      source: 'test',
      payload: { message: 'Item 2' },
    });
    pushToHook(TEST_AGENT_ID, {
      type: 'task',
      priority: 'normal',
      source: 'test',
      payload: { message: 'Item 3' },
    });

    const hook = getHook(TEST_AGENT_ID);
    expect(hook).toBeDefined();
    expect(hook!.items).toHaveLength(3);

    const originalOrder = hook!.items.map(item => item.id);

    // Reorder: move last item to first
    const newOrder = [originalOrder[2], originalOrder[0], originalOrder[1]];
    const success = reorderHookItems(TEST_AGENT_ID, newOrder);

    expect(success).toBe(true);

    // Verify new order
    const reorderedHook = getHook(TEST_AGENT_ID);
    expect(reorderedHook!.items).toHaveLength(3);
    expect(reorderedHook!.items[0].id).toBe(originalOrder[2]);
    expect(reorderedHook!.items[1].id).toBe(originalOrder[0]);
    expect(reorderedHook!.items[2].id).toBe(originalOrder[1]);
  });

  it('should return false if hook does not exist', () => {
    const success = reorderHookItems('non-existent-agent', ['id1', 'id2']);
    expect(success).toBe(false);
  });

  it('should return false if item ID not found', () => {
    pushToHook(TEST_AGENT_ID, {
      type: 'task',
      priority: 'normal',
      source: 'test',
      payload: { message: 'Item 1' },
    });

    const hook = getHook(TEST_AGENT_ID);
    const validId = hook!.items[0].id;

    // Try to reorder with an invalid ID
    const success = reorderHookItems(TEST_AGENT_ID, [validId, 'invalid-id']);
    expect(success).toBe(false);
  });

  it('should return false if item count mismatch', () => {
    pushToHook(TEST_AGENT_ID, {
      type: 'task',
      priority: 'normal',
      source: 'test',
      payload: { message: 'Item 1' },
    });
    pushToHook(TEST_AGENT_ID, {
      type: 'task',
      priority: 'normal',
      source: 'test',
      payload: { message: 'Item 2' },
    });

    const hook = getHook(TEST_AGENT_ID);
    const firstId = hook!.items[0].id;

    // Try to reorder with only one ID when there are two items
    const success = reorderHookItems(TEST_AGENT_ID, [firstId]);
    expect(success).toBe(false);
  });

  it('should preserve all item fields when reordering', () => {
    // Ensure clean state
    clearHook(TEST_AGENT_ID);

    pushToHook(TEST_AGENT_ID, {
      type: 'task',
      priority: 'urgent',
      source: 'handoff',
      payload: { issueId: 'PAN-123', message: 'Urgent task' },
    });
    pushToHook(TEST_AGENT_ID, {
      type: 'message',
      priority: 'normal',
      source: 'user',
      payload: { message: 'Normal message' },
    });

    const hook = getHook(TEST_AGENT_ID);
    expect(hook!.items).toHaveLength(2); // Verify we only have 2 items
    const originalOrder = hook!.items.map(item => item.id);

    // Reverse order
    const newOrder = [originalOrder[1], originalOrder[0]];
    reorderHookItems(TEST_AGENT_ID, newOrder);

    const reorderedHook = getHook(TEST_AGENT_ID);
    expect(reorderedHook!.items).toHaveLength(2); // Still only 2 items

    // Verify first item (was second) kept all fields
    expect(reorderedHook!.items[0].type).toBe('message');
    expect(reorderedHook!.items[0].priority).toBe('normal');
    expect(reorderedHook!.items[0].source).toBe('user');
    expect(reorderedHook!.items[0].payload.message).toBe('Normal message');

    // Verify second item (was first) kept all fields
    expect(reorderedHook!.items[1].type).toBe('task');
    expect(reorderedHook!.items[1].priority).toBe('urgent');
    expect(reorderedHook!.items[1].source).toBe('handoff');
    expect(reorderedHook!.items[1].payload.issueId).toBe('PAN-123');
  });

  it('should handle empty queue', () => {
    // Create empty hook
    clearHook(TEST_AGENT_ID);

    const success = reorderHookItems(TEST_AGENT_ID, []);
    expect(success).toBe(true); // Empty reorder of empty queue should succeed
  });
});
