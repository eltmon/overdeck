/**
 * Unit tests for shadow-state.ts
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

// Helper to clean up test files
function cleanupTestFiles() {
  if (existsSync(TEST_SHADOW_STATE_DIR)) {
    const files = readdirSync(TEST_SHADOW_STATE_DIR);
    for (const file of files) {
      if (file.startsWith('TEST-')) {
        unlinkSync(join(TEST_SHADOW_STATE_DIR, file));
      }
    }
  }
}

describe('shadow-state', () => {
  beforeEach(() => {
    cleanupTestFiles();
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  describe('createShadowState', () => {
    it('should create a new shadow state for an issue', () => {
      const state = createShadowState('TEST-123', 'open', 'test');

      expect(state.issueId).toBe('TEST-123');
      expect(state.shadowStatus).toBe('open');
      expect(state.trackerStatus).toBe('open');
      expect(state.history).toEqual([]);
      expect(state.shadowedAt).toBeDefined();
    });

    it('should normalize issue ID to uppercase', () => {
      const state = createShadowState('test-456', 'in_progress');
      expect(state.issueId).toBe('TEST-456');
    });
  });

  describe('getShadowState', () => {
    it('should return null for non-existent shadow state', () => {
      const state = getShadowState('TEST-NONEXISTENT');
      expect(state).toBeNull();
    });

    it('should return the shadow state for an existing issue', () => {
      createShadowState('TEST-789', 'open');
      const state = getShadowState('TEST-789');

      expect(state).not.toBeNull();
      expect(state?.issueId).toBe('TEST-789');
    });

    it('should be case insensitive', () => {
      createShadowState('TEST-ABC', 'open');
      const state = getShadowState('test-abc');

      expect(state).not.toBeNull();
    });
  });

  describe('isShadowed', () => {
    it('should return false for non-shadowed issues', () => {
      expect(isShadowed('TEST-NOTSHADOWED')).toBe(false);
    });

    it('should return true for shadowed issues', () => {
      createShadowState('TEST-SHADOWED', 'open');
      expect(isShadowed('TEST-SHADOWED')).toBe(true);
    });
  });

  describe('updateShadowState', () => {
    it('should update the shadow status', () => {
      createShadowState('TEST-UPDATE', 'open');
      const updated = updateShadowState('TEST-UPDATE', 'in_progress', 'test-command');

      expect(updated.shadowStatus).toBe('in_progress');
      expect(updated.history.length).toBe(1);
      expect(updated.history[0].from).toBe('open');
      expect(updated.history[0].to).toBe('in_progress');
      expect(updated.history[0].by).toBe('test-command');
      expect(updated.history[0].syncedToTracker).toBe(false);
    });

    it('should not add history entry if status is unchanged', () => {
      createShadowState('TEST-NOCHANGE', 'open');
      const updated = updateShadowState('TEST-NOCHANGE', 'open', 'test');

      expect(updated.shadowStatus).toBe('open');
      expect(updated.history.length).toBe(0);
    });

    it('should create shadow state if it does not exist', () => {
      const updated = updateShadowState('TEST-AUTOCREATE', 'closed', 'test');

      expect(updated.issueId).toBe('TEST-AUTOCREATE');
      expect(updated.shadowStatus).toBe('closed');
    });
  });

  describe('markAsSynced', () => {
    it('should mark shadow state as synced', () => {
      createShadowState('TEST-SYNC', 'open');
      updateShadowState('TEST-SYNC', 'in_progress', 'test');

      const result = markAsSynced('TEST-SYNC', 'in_progress', 'open');

      expect(result.success).toBe(true);
      expect(result.syncedState).toBe('in_progress');
      expect(result.previousState).toBe('open');
      expect(result.entriesSynced).toBe(1);

      const state = getShadowState('TEST-SYNC');
      expect(state?.syncedAt).toBeDefined();
      expect(state?.history[0].syncedToTracker).toBe(true);
    });

    it('should return error for non-existent issue', () => {
      const result = markAsSynced('TEST-NOEXIST', 'closed');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in shadow mode');
    });
  });

  describe('needsSync', () => {
    it('should return false when shadow status matches tracker status', () => {
      createShadowState('TEST-INSYNC', 'open');
      expect(needsSync('TEST-INSYNC')).toBe(false);
    });

    it('should return true when shadow status differs from tracker status', () => {
      createShadowState('TEST-OUTSYNC', 'open');
      updateShadowState('TEST-OUTSYNC', 'in_progress', 'test');
      expect(needsSync('TEST-OUTSYNC')).toBe(true);
    });

    it('should return false for non-shadowed issues', () => {
      expect(needsSync('TEST-NOTSHADOWED')).toBe(false);
    });
  });

  describe('getUnsyncedHistory', () => {
    it('should return empty array for non-shadowed issue', () => {
      const history = getUnsyncedHistory('TEST-NOEXIST');
      expect(history).toEqual([]);
    });

    it('should return only unsynced entries', () => {
      createShadowState('TEST-HISTORY', 'open');
      updateShadowState('TEST-HISTORY', 'in_progress', 'cmd1');
      updateShadowState('TEST-HISTORY', 'closed', 'cmd2');

      let unsynced = getUnsyncedHistory('TEST-HISTORY');
      expect(unsynced.length).toBe(2);

      markAsSynced('TEST-HISTORY', 'closed');

      unsynced = getUnsyncedHistory('TEST-HISTORY');
      expect(unsynced.length).toBe(0);
    });
  });

  describe('listShadowedIssues', () => {
    it('should return empty array when no issues are shadowed', () => {
      const issues = listShadowedIssues();
      const testIssues = issues.filter(i => i.issueId.startsWith('TEST-'));
      expect(testIssues).toEqual([]);
    });

    it('should return all shadowed issues sorted by shadowedAt', () => {
      createShadowState('TEST-A', 'open');
      createShadowState('TEST-B', 'open');

      const issues = listShadowedIssues();
      const testIssues = issues.filter(i => i.issueId.startsWith('TEST-'));

      expect(testIssues.length).toBe(2);
      // Should be sorted by shadowedAt descending (newest first)
      expect(testIssues[0].shadowedAt >= testIssues[1].shadowedAt).toBe(true);
    });
  });

  describe('getPendingSyncCount', () => {
    it('should return 0 when no issues need sync', () => {
      createShadowState('TEST-NOSYNCNEEDED', 'open');
      expect(getPendingSyncCount()).toBe(0);
    });

    it('should return count of issues needing sync', () => {
      createShadowState('TEST-PENDING1', 'open');
      updateShadowState('TEST-PENDING1', 'in_progress', 'test');

      const count = getPendingSyncCount();
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getDisplayStatus', () => {
    it('should return non-shadowed status for non-shadowed issues', () => {
      const status = getDisplayStatus('TEST-NOTSHADOWED', 'open');

      expect(status.status).toBe('open');
      expect(status.isShadowed).toBe(false);
      expect(status.trackerStatus).toBeUndefined();
    });

    it('should return shadow status with tracker info for shadowed issues', () => {
      createShadowState('TEST-DISPLAY', 'open');
      updateShadowState('TEST-DISPLAY', 'in_progress', 'test');

      const status = getDisplayStatus('TEST-DISPLAY', 'open');

      expect(status.status).toBe('in_progress');
      expect(status.isShadowed).toBe(true);
      expect(status.trackerStatus).toBe('open');
      expect(status.outOfSync).toBe(true);
    });
  });

  describe('updateTrackerStatusCache', () => {
    it('should update tracker status cache', () => {
      createShadowState('TEST-CACHE', 'open');
      const updated = updateTrackerStatusCache('TEST-CACHE', 'in_progress');

      expect(updated.trackerStatus).toBe('in_progress');
      expect(updated.trackerStatusUpdatedAt).toBeDefined();
    });

    it('should throw error for non-shadowed issue', () => {
      expect(() => {
        updateTrackerStatusCache('TEST-NOEXIST', 'open');
      }).toThrow('not in shadow mode');
    });
  });

  describe('removeShadowState', () => {
    it('should remove shadow state for an issue', () => {
      createShadowState('TEST-REMOVE', 'open');
      expect(isShadowed('TEST-REMOVE')).toBe(true);

      const result = removeShadowState('TEST-REMOVE');

      expect(result.success).toBe(true);
      expect(isShadowed('TEST-REMOVE')).toBe(false);
    });

    it('should return error for non-existent issue', () => {
      const result = removeShadowState('TEST-NOEXIST');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in shadow mode');
    });
  });
});
