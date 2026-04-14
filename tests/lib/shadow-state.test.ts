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
    it('should create a new shadow state for an issue', async () => {
      const id = getUniqueId('create');
      const state = await createShadowState(id, 'open', 'test');

      expect(state.issueId).toBe(id.toUpperCase());
      expect(state.shadowStatus).toBe('open');
      expect(state.trackerStatus).toBe('open');
      expect(state.history).toEqual([]);
      expect(state.shadowedAt).toBeDefined();
    });

    it('should normalize issue ID to uppercase', async () => {
      const id = getUniqueId('uppercase');
      const state = await createShadowState(id.toLowerCase(), 'in_progress');
      expect(state.issueId).toBe(id.toUpperCase());
    });
  });

  describe('getShadowState', () => {
    it('should return null for non-existent shadow state', async () => {
      const state = await getShadowState(getUniqueId('nonexistent'));
      expect(state).toBeNull();
    });

    it('should return the shadow state for an existing issue', async () => {
      const id = getUniqueId('existing');
      await createShadowState(id, 'open');
      const state = await getShadowState(id);

      expect(state).not.toBeNull();
      expect(state?.issueId).toBe(id.toUpperCase());
    });

    it('should be case insensitive', async () => {
      const id = getUniqueId('case');
      await createShadowState(id, 'open');
      const state = await getShadowState(id.toLowerCase());

      expect(state).not.toBeNull();
    });
  });

  describe('isShadowed', () => {
    it('should return false for non-shadowed issues', async () => {
      expect(await isShadowed(getUniqueId('notshadowed'))).toBe(false);
    });

    it('should return true for shadowed issues', async () => {
      const id = getUniqueId('shadowed');
      await createShadowState(id, 'open');
      expect(await isShadowed(id)).toBe(true);
    });
  });

  describe('updateShadowState', () => {
    it('should update the shadow status', async () => {
      const id = getUniqueId('update');
      await createShadowState(id, 'open');
      const updated = await updateShadowState(id, 'in_progress', 'test-command');

      expect(updated.shadowStatus).toBe('in_progress');
      expect(updated.history.length).toBe(1);
      expect(updated.history[0].from).toBe('open');
      expect(updated.history[0].to).toBe('in_progress');
      expect(updated.history[0].by).toBe('test-command');
      expect(updated.history[0].syncedToTracker).toBe(false);
    });

    it('should not add history entry if status is unchanged', async () => {
      const id = getUniqueId('nochange');
      await createShadowState(id, 'open');
      const updated = await updateShadowState(id, 'open', 'test');

      expect(updated.shadowStatus).toBe('open');
      expect(updated.history.length).toBe(0);
    });

    it('should create shadow state if it does not exist', async () => {
      const id = getUniqueId('autocreate');
      const updated = await updateShadowState(id, 'closed', 'test');

      expect(updated.issueId).toBe(id.toUpperCase());
      expect(updated.shadowStatus).toBe('closed');
    });
  });

  describe('markAsSynced', () => {
    it('should mark shadow state as synced', async () => {
      const id = getUniqueId('sync');
      await createShadowState(id, 'open');
      await updateShadowState(id, 'in_progress', 'test');

      const result = await markAsSynced(id, 'in_progress', 'open');

      expect(result.success).toBe(true);
      expect(result.syncedState).toBe('in_progress');
      expect(result.previousState).toBe('open');
      expect(result.entriesSynced).toBe(1);

      const state = await getShadowState(id);
      expect(state?.syncedAt).toBeDefined();
      expect(state?.history[0].syncedToTracker).toBe(true);
    });

    it('should return error for non-existent issue', async () => {
      const result = await markAsSynced(getUniqueId('noexist'), 'closed');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in shadow mode');
    });
  });

  describe('needsSync', () => {
    it('should return false when shadow status matches tracker status', async () => {
      const id = getUniqueId('insync');
      await createShadowState(id, 'open');
      expect(await needsSync(id)).toBe(false);
    });

    it('should return true when shadow status differs from tracker status', async () => {
      const id = getUniqueId('outsync');
      await createShadowState(id, 'open');
      await updateShadowState(id, 'in_progress', 'test');
      expect(await needsSync(id)).toBe(true);
    });

    it('should return false for non-shadowed issues', async () => {
      expect(await needsSync(getUniqueId('notshadowed'))).toBe(false);
    });
  });

  describe('getUnsyncedHistory', () => {
    it('should return empty array for non-shadowed issue', async () => {
      const history = await getUnsyncedHistory(getUniqueId('noexist'));
      expect(history).toEqual([]);
    });

    it('should return only unsynced entries', async () => {
      const id = getUniqueId('history');
      await createShadowState(id, 'open');
      await updateShadowState(id, 'in_progress', 'cmd1');
      await updateShadowState(id, 'closed', 'cmd2');

      let unsynced = await getUnsyncedHistory(id);
      expect(unsynced.length).toBe(2);

      await markAsSynced(id, 'closed');

      unsynced = await getUnsyncedHistory(id);
      expect(unsynced.length).toBe(0);
    });
  });

  describe('listShadowedIssues', () => {
    it('should return empty array when no issues are shadowed', async () => {
      const issues = await listShadowedIssues();
      const testIssues = issues.filter(i => i.issueId.includes('TEST-'));
      expect(testIssues).toEqual([]);
    });

    it('should return all shadowed issues sorted by shadowedAt', async () => {
      const id1 = getUniqueId('sorta');
      const id2 = getUniqueId('sortb');
      await createShadowState(id1, 'open');
      await createShadowState(id2, 'open');

      const issues = await listShadowedIssues();
      const testIssues = issues.filter(i => i.issueId.includes('TEST-'));

      expect(testIssues.length).toBeGreaterThanOrEqual(2);
      // Should be sorted by shadowedAt descending (newest first)
      if (testIssues.length >= 2) {
        expect(testIssues[0].shadowedAt >= testIssues[1].shadowedAt).toBe(true);
      }
    });
  });

  describe('getPendingSyncCount', () => {
    // NOTE: getPendingSyncCount() scans ALL files in ~/.panopticon/shadow-state/, so
    // asserting a global count of 0 is environment-dependent. Tests below use
    // needsSync(id) on the specific issue under test instead.
    // Tracked in: https://github.com/eltmon/panopticon-cli/issues/683
    it('should not count fresh issues as needing sync', async () => {
      const id = getUniqueId('nosync');
      await createShadowState(id, 'open');
      expect(await needsSync(id)).toBe(false);
    });

    it('should count issues needing sync', async () => {
      const id = getUniqueId('pending');
      await createShadowState(id, 'open');
      await updateShadowState(id, 'in_progress', 'test');

      expect(await needsSync(id)).toBe(true);
    });
  });

  describe('getDisplayStatus', () => {
    it('should return non-shadowed status for non-shadowed issues', async () => {
      const status = await getDisplayStatus(getUniqueId('notshadowed'), 'open');

      expect(status.status).toBe('open');
      expect(status.isShadowed).toBe(false);
      expect(status.trackerStatus).toBeUndefined();
    });

    it('should return shadow status with tracker info for shadowed issues', async () => {
      const id = getUniqueId('display');
      await createShadowState(id, 'open');
      await updateShadowState(id, 'in_progress', 'test');

      const status = await getDisplayStatus(id, 'open');

      expect(status.status).toBe('in_progress');
      expect(status.isShadowed).toBe(true);
      expect(status.trackerStatus).toBe('open');
      expect(status.outOfSync).toBe(true);
    });
  });

  describe('updateTrackerStatusCache', () => {
    it('should update tracker status cache', async () => {
      const id = getUniqueId('cache');
      await createShadowState(id, 'open');
      const updated = await updateTrackerStatusCache(id, 'in_progress');

      expect(updated.trackerStatus).toBe('in_progress');
      expect(updated.trackerStatusUpdatedAt).toBeDefined();
    });

    it('should throw error for non-shadowed issue', async () => {
      await expect(
        updateTrackerStatusCache(getUniqueId('noexist'), 'open')
      ).rejects.toThrow('not in shadow mode');
    });
  });

  describe('removeShadowState', () => {
    it('should remove shadow state for an issue', async () => {
      const id = getUniqueId('remove');
      await createShadowState(id, 'open');
      expect(await isShadowed(id)).toBe(true);

      const result = removeShadowState(id);

      expect(result.success).toBe(true);
      expect(await isShadowed(id)).toBe(false);
    });

    it('should return error for non-existent issue', () => {
      const result = removeShadowState(getUniqueId('noexist'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in shadow mode');
    });
  });
});
