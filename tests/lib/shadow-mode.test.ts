/**
 * Unit tests for shadow-mode.ts
 *
 * @vitest-environment node
 * These tests use the filesystem and should not run in parallel with other shadow tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Import the functions we're testing
import {
  resolveShadowMode,
  isShadowModeEnabled,
  shouldSkipTrackerUpdate,
  getShadowModeStatus,
  hasProjectShadowConfig,
  getShadowModeSummary,
} from '../../src/lib/shadow-mode.js';

import {
  createShadowState,
  removeShadowState,
} from '../../src/lib/shadow-state.js';

const TEST_SHADOW_STATE_DIR = join(homedir(), '.panopticon', 'shadow-state');

// Unique prefix for this test file to avoid conflicts with shadow-state.test.ts
const TEST_PREFIX = 'TEST-SMODE';

// Helper to clean up test files
function cleanupTestFiles() {
  if (existsSync(TEST_SHADOW_STATE_DIR)) {
    const files = readdirSync(TEST_SHADOW_STATE_DIR);
    for (const file of files) {
      if (file.startsWith('TEST-')) {
        try {
          unlinkSync(join(TEST_SHADOW_STATE_DIR, file));
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  }
  // Clear env var
  delete process.env.SHADOW_MODE;
}

// Unique ID generator for test isolation
let testIdCounter = 0;
function getUniqueId(base: string): string {
  return `${TEST_PREFIX}-${base}-${Date.now()}-${++testIdCounter}`;
}

describe('shadow-mode', () => {
  beforeEach(() => {
    cleanupTestFiles();
    testIdCounter = 0;
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  describe('resolveShadowMode', () => {
    it('should return cli source when cliFlag is provided', async () => {
      const result = await resolveShadowMode({ cliFlag: true });
      expect(result.enabled).toBe(true);
      expect(result.source).toBe('cli');

      const result2 = await resolveShadowMode({ cliFlag: false });
      expect(result2.enabled).toBe(false);
      expect(result2.source).toBe('cli');
    });

    it('should return existing source when issue is already shadowed', async () => {
      const id = getUniqueId('existing');
      await createShadowState(id, 'open');

      const result = await resolveShadowMode({ issueId: id });

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('existing');

      removeShadowState(id);
    });

    it('should return default when no config is set', async () => {
      const result = await resolveShadowMode({ issueId: getUniqueId('notshadowed') });
      expect(result.source).toBe('default');
    });

    it('should respect tracker type overrides', async () => {
      const result = await resolveShadowMode({ trackerType: 'linear' });
      expect(result.trackerType).toBe('linear');
    });
  });

  describe('isShadowModeEnabled', () => {
    it('should return true when cliFlag is true', async () => {
      expect(await isShadowModeEnabled({ cliFlag: true })).toBe(true);
    });

    it('should return false when cliFlag is false', async () => {
      expect(await isShadowModeEnabled({ cliFlag: false })).toBe(false);
    });

    it('should return true for shadowed issues', async () => {
      const id = getUniqueId('enabled');
      await createShadowState(id, 'open');

      expect(await isShadowModeEnabled({ issueId: id })).toBe(true);

      removeShadowState(id);
    });
  });

  describe('shouldSkipTrackerUpdate', () => {
    it('should return true when cliFlag is true', async () => {
      expect(await shouldSkipTrackerUpdate(getUniqueId('skip'), true)).toBe(true);
    });

    it('should return false when cliFlag is false', async () => {
      expect(await shouldSkipTrackerUpdate(getUniqueId('noskip'), false)).toBe(false);
    });

    it('should use default tracker type when not specified', async () => {
      const result = await shouldSkipTrackerUpdate(getUniqueId('default'), undefined);
      expect(typeof result).toBe('boolean');
    });

    it('should respect tracker type parameter', async () => {
      expect(typeof (await shouldSkipTrackerUpdate(getUniqueId('github'), undefined, 'github'))).toBe('boolean');
      expect(typeof (await shouldSkipTrackerUpdate(getUniqueId('gitlab'), undefined, 'gitlab'))).toBe('boolean');
    });
  });

  describe('getShadowModeStatus', () => {
    it('should return disabled message when shadow mode is off', async () => {
      const status = await getShadowModeStatus({ cliFlag: false });
      expect(status).toContain('disabled');
    });

    it('should return enabled message with source when shadow mode is on', async () => {
      const status = await getShadowModeStatus({ cliFlag: true });
      expect(status).toContain('enabled');
      expect(status).toContain('CLI flag');
    });

    it('should include tracker type when provided', async () => {
      const status = await getShadowModeStatus({ cliFlag: true, trackerType: 'linear' });
      expect(status).toContain('linear');
    });
  });

  describe('getShadowModeSummary', () => {
    it('should return summary object with expected keys', async () => {
      const summary = await getShadowModeSummary();

      expect(summary).toHaveProperty('globalEnabled');
      expect(summary).toHaveProperty('perTracker');
      expect(summary).toHaveProperty('envSet');
      expect(summary).toHaveProperty('pendingSyncCount');

      expect(typeof summary.globalEnabled).toBe('boolean');
      expect(typeof summary.perTracker).toBe('object');
      expect(typeof summary.envSet).toBe('boolean');
      expect(typeof summary.pendingSyncCount).toBe('number');
    });

    it('should detect environment variable', async () => {
      process.env.SHADOW_MODE = 'true';

      const summary = await getShadowModeSummary();
      expect(summary.envSet).toBe(true);

      delete process.env.SHADOW_MODE;
    });
  });

  describe('hasProjectShadowConfig', () => {
    it('should return a boolean', () => {
      const result = hasProjectShadowConfig();
      expect(typeof result).toBe('boolean');
    });
  });
});
