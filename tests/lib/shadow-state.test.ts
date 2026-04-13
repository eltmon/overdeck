/**
 * Unit tests for shadow-state.ts
 *
 * @vitest-environment node
 * These tests use the filesystem and should not run in parallel with other shadow tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync, unlinkSync, rmdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Import the functions we're testing
import {
  getShadowState,
  createShadowState,
  updateShadowState,
  markAsSynced,
  listShadowedIssues,
  isShadowed,
  needsSync,
  getUnsyncedHistory,
  updateTrackerStatusCache,
  removeShadowState,
  getPendingSyncCount,
  getDisplayStatus,
} from '../../src/lib/shadow-state.js';

const TEST_SHADOW_STATE_DIR = join(homedir(), '.panopticon', 'shadow-state');

// Unique prefix for this test file to avoid conflicts with shadow-mode.test.ts
const TEST_PREFIX = 'TEST-SSTATE';

// Helper to clean up test files
function cleanupTestFiles() {
  if (existsSync(TEST_SHADOW_STATE_DIR)) {
    const files = readdirSync(TEST_SHADOW_STATE_DIR);
    for (const file of files) {
      if (file.startsWith(TEST_PREFIX)) {
        try {
          unlinkSync(join(TEST_SHADOW_STATE_DIR, file));
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  }
}

// Unique ID generator for test isolation
let testIdCounter = 0;
function getUniqueId(base: string): string {
  return `${TEST_PREFIX}-${base}-${Date.now()}-${++testIdCounter}`;
}

describe('shadow-state', () => {
  beforeEach(() => {
    cleanupTestFiles();
    testIdCounter = 0;
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  describe('createShadowState', () => {
    it('should create a new shadow state for an issue', () => {
      const id = getUniqueId('create');
      const state = createShadowState(id, 'open', 'test');

      expect(state.issueId).toBe(id.toUpperCase());
      expect(state.shadowStatus).toBe('open');
      expect(state.trackerStatus).toBe('open');
      expect(state.history).toEqual([]);
      expect(state.shadowedAt).toBeDefined();
    });

    it('should normalize issue ID to uppercase', () => {
      const id = getUniqueId('uppercase');
      const state = createShadowState(id.toLowerCase(), 'in_progress');
      expect(state.issueId).toBe(id.toUpperCase());
    });
  });

  describe('getShadowState', () => {
    it('should return null for non-existent shadow state', () => {
      const state = getShadowState(getUniqueId('nonexistent'));
      expect(state).toBeNull();
    });

    it('should return the shadow state for an existing issue', () => {
      const id = getUniqueId('existing');
      createShadowState(id, 'open');
      const state = getShadowState(id);

      expect(state).not.toBeNull();
      expect(state?.issueId).toBe(id.toUpperCase());
    });

    it('should be case insensitive', () => {
      const id = getUniqueId('case');
      createShadowState(id, 'open');
      const state = getShadowState(id.toLowerCase());

      expect(state).not.toBeNull();
    });
  });

  describe('isShadowed', () => {
    it('should return false for non-shadowed issues', () => {
      expect(isShadowed(getUniqueId('notshadowed'))).toBe(false);
    });

    it('should return true for shadowed issues', () => {
      const id = getUniqueId('shadowed');
      createShadowState(id, 'open');
      expect(isShadowed(id)).toBe(true);
    });
  });

  describe('updateShadowState', () => {
    it('should update the shadow status', () => {
      const id = getUniqueId('update');
      createShadowState(id, 'open');
      const updated = updateShadowState(id, 'in_progress', 'test-command');

      expect(updated.shadowStatus).toBe('in_progress');
      expect(updated.history.length).toBe(1);
      expect(updated.history[0].from).toBe('open');
      expect(updated.history[0].to).toBe('in_progress');
      expect(updated.history[0].by).toBe('test-command');
      expect(updated.history[0].syncedToTracker).toBe(false);
    });

    it('should not add history entry if status is unchanged', () => {
      const id = getUniqueId('nochange');
      createShadowState(id, 'open');
      const updated = updateShadowState(id, 'open', 'test');

      expect(updated.shadowStatus).toBe('open');
      expect(updated.history.length).toBe(0);
    });

    it('should create shadow state if it does not exist', () => {
      const id = getUniqueId('autocreate');
      const updated = updateShadowState(id, 'closed', 'test');

      expect(updated.issueId).toBe(id.toUpperCase());
      expect(updated.shadowStatus).toBe('closed');
    });
  });

  describe('markAsSynced', () => {
    it('should mark shadow state as synced', () => {
      const id = getUniqueId('sync');
      createShadowState(id, 'open');
      updateShadowState(id, 'in_progress', 'test');

      const result = markAsSynced(id, 'in_progress', 'open');

      expect(result.success).toBe(true);
      expect(result.syncedState).toBe('in_progress');
      expect(result.previousState).toBe('open');
      expect(result.entriesSynced).toBe(1);

      const state = getShadowState(id);
      expect(state?.syncedAt).toBeDefined();
      expect(state?.history[0].syncedToTracker).toBe(true);
    });

    it('should return error for non-existent issue', () => {
      const result = markAsSynced(getUniqueId('noexist'), 'closed');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in shadow mode');
    });
  });

  describe('needsSync', () => {
    it('should return false when shadow status matches tracker status', () => {
      const id = getUniqueId('insync');
      createShadowState(id, 'open');
      expect(needsSync(id)).toBe(false);
    });

    it('should return true when shadow status differs from tracker status', () => {
      const id = getUniqueId('outsync');
      createShadowState(id, 'open');
      updateShadowState(id, 'in_progress', 'test');
      expect(needsSync(id)).toBe(true);
    });

    it('should return false for non-shadowed issues', () => {
      expect(needsSync(getUniqueId('notshadowed'))).toBe(false);
    });
  });

  describe('getUnsyncedHistory', () => {
    it('should return empty array for non-shadowed issue', () => {
      const history = getUnsyncedHistory(getUniqueId('noexist'));
      expect(history).toEqual([]);
    });

    it('should return only unsynced entries', () => {
      const id = getUniqueId('history');
      createShadowState(id, 'open');
      updateShadowState(id, 'in_progress', 'cmd1');
      updateShadowState(id, 'closed', 'cmd2');

      let unsynced = getUnsyncedHistory(id);
      expect(unsynced.length).toBe(2);

      markAsSynced(id, 'closed');

      unsynced = getUnsyncedHistory(id);
      expect(unsynced.length).toBe(0);
    });
  });

  describe('listShadowedIssues', () => {
    it('should return empty array when no issues are shadowed', () => {
      const issues = listShadowedIssues();
      const testIssues = issues.filter(i => i.issueId.includes('TEST-'));
      expect(testIssues).toEqual([]);
    });

    it('should return all shadowed issues sorted by shadowedAt', () => {
      const id1 = getUniqueId('sorta');
      const id2 = getUniqueId('sortb');
      createShadowState(id1, 'open');
      createShadowState(id2, 'open');

      const issues = listShadowedIssues();
      const testIssues = issues.filter(i => i.issueId.includes('TEST-'));

      expect(testIssues.length).toBeGreaterThanOrEqual(2);
      // Should be sorted by shadowedAt descending (newest first)
      if (testIssues.length >= 2) {
        expect(testIssues[0].shadowedAt >= testIssues[1].shadowedAt).toBe(true);
      }
    });
  });

  describe('getPendingSyncCount', () => {
    it('should not increase count when issue is in sync', () => {
      const before = getPendingSyncCount();
      const id = getUniqueId('nosync');
      createShadowState(id, 'open');
      // Creating a state with matching statuses should not add to the pending count
      expect(getPendingSyncCount()).toBe(before);
    });

    it('should increase count when issue needs sync', () => {
      const before = getPendingSyncCount();
      const id = getUniqueId('pending');
      createShadowState(id, 'open');
      updateShadowState(id, 'in_progress', 'test');

      expect(getPendingSyncCount()).toBeGreaterThan(before);
    });
  });

  describe('getDisplayStatus', () => {
    it('should return non-shadowed status for non-shadowed issues', () => {
      const status = getDisplayStatus(getUniqueId('notshadowed'), 'open');

      expect(status.status).toBe('open');
      expect(status.isShadowed).toBe(false);
      expect(status.trackerStatus).toBeUndefined();
    });

    it('should return shadow status with tracker info for shadowed issues', () => {
      const id = getUniqueId('display');
      createShadowState(id, 'open');
      updateShadowState(id, 'in_progress', 'test');

      const status = getDisplayStatus(id, 'open');

      expect(status.status).toBe('in_progress');
      expect(status.isShadowed).toBe(true);
      expect(status.trackerStatus).toBe('open');
      expect(status.outOfSync).toBe(true);
    });
  });

  describe('updateTrackerStatusCache', () => {
    it('should update tracker status cache', () => {
      const id = getUniqueId('cache');
      createShadowState(id, 'open');
      const updated = updateTrackerStatusCache(id, 'in_progress');

      expect(updated.trackerStatus).toBe('in_progress');
      expect(updated.trackerStatusUpdatedAt).toBeDefined();
    });

    it('should throw error for non-shadowed issue', () => {
      expect(() => {
        updateTrackerStatusCache(getUniqueId('noexist'), 'open');
      }).toThrow('not in shadow mode');
    });
  });

  describe('removeShadowState', () => {
    it('should remove shadow state for an issue', () => {
      const id = getUniqueId('remove');
      createShadowState(id, 'open');
      expect(isShadowed(id)).toBe(true);

      const result = removeShadowState(id);

      expect(result.success).toBe(true);
      expect(isShadowed(id)).toBe(false);
    });

    it('should return error for non-existent issue', () => {
      const result = removeShadowState(getUniqueId('noexist'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in shadow mode');
    });
  });
});
