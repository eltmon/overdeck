/**
 * Unit tests for shadow-mode.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, rmdirSync, mkdirSync } from 'fs';
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

// Helper to clean up test files
function cleanupTestFiles() {
  if (existsSync(TEST_SHADOW_STATE_DIR)) {
    const files = require('fs').readdirSync(TEST_SHADOW_STATE_DIR);
    for (const file of files) {
      if (file.startsWith('TEST-')) {
        unlinkSync(join(TEST_SHADOW_STATE_DIR, file));
      }
    }
  }
  // Clear env var
  delete process.env.SHADOW_MODE;
}

describe('shadow-mode', () => {
  beforeEach(() => {
    cleanupTestFiles();
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  describe('resolveShadowMode', () => {
    it('should return cli source when cliFlag is provided', () => {
      const result = resolveShadowMode({ cliFlag: true });
      expect(result.enabled).toBe(true);
      expect(result.source).toBe('cli');

      const result2 = resolveShadowMode({ cliFlag: false });
      expect(result2.enabled).toBe(false);
      expect(result2.source).toBe('cli');
    });

    it('should return existing source when issue is already shadowed', () => {
      createShadowState('TEST-EXISTING', 'open');

      const result = resolveShadowMode({ issueId: 'TEST-EXISTING' });

      expect(result.enabled).toBe(true);
      expect(result.source).toBe('existing');

      removeShadowState('TEST-EXISTING');
    });

    it('should return default when no config is set', () => {
      const result = resolveShadowMode({ issueId: 'TEST-NOTSHADOWED' });
      expect(result.source).toBe('default');
    });

    it('should respect tracker type overrides', () => {
      const result = resolveShadowMode({ trackerType: 'linear' });
      expect(result.trackerType).toBe('linear');
    });
  });

  describe('isShadowModeEnabled', () => {
    it('should return true when cliFlag is true', () => {
      expect(isShadowModeEnabled({ cliFlag: true })).toBe(true);
    });

    it('should return false when cliFlag is false', () => {
      expect(isShadowModeEnabled({ cliFlag: false })).toBe(false);
    });

    it('should return true for shadowed issues', () => {
      createShadowState('TEST-ENABLED', 'open');

      expect(isShadowModeEnabled({ issueId: 'TEST-ENABLED' })).toBe(true);

      removeShadowState('TEST-ENABLED');
    });
  });

  describe('shouldSkipTrackerUpdate', () => {
    it('should return true when cliFlag is true', () => {
      expect(shouldSkipTrackerUpdate('TEST-123', true)).toBe(true);
    });

    it('should return false when cliFlag is false', () => {
      expect(shouldSkipTrackerUpdate('TEST-123', false)).toBe(false);
    });

    it('should use default tracker type when not specified', () => {
      const result = shouldSkipTrackerUpdate('TEST-123', undefined);
      // Default should be false unless env/config says otherwise
      expect(typeof result).toBe('boolean');
    });

    it('should respect tracker type parameter', () => {
      // Test with different tracker types
      expect(typeof shouldSkipTrackerUpdate('TEST-123', undefined, 'github')).toBe('boolean');
      expect(typeof shouldSkipTrackerUpdate('TEST-123', undefined, 'gitlab')).toBe('boolean');
    });
  });

  describe('getShadowModeStatus', () => {
    it('should return disabled message when shadow mode is off', () => {
      const status = getShadowModeStatus({ cliFlag: false });
      expect(status).toContain('disabled');
    });

    it('should return enabled message with source when shadow mode is on', () => {
      const status = getShadowModeStatus({ cliFlag: true });
      expect(status).toContain('enabled');
      expect(status).toContain('CLI flag');
    });

    it('should include tracker type when provided', () => {
      const status = getShadowModeStatus({ cliFlag: true, trackerType: 'linear' });
      expect(status).toContain('linear');
    });
  });

  describe('getShadowModeSummary', () => {
    it('should return summary object with expected keys', () => {
      const summary = getShadowModeSummary();

      expect(summary).toHaveProperty('globalEnabled');
      expect(summary).toHaveProperty('perTracker');
      expect(summary).toHaveProperty('envSet');
      expect(summary).toHaveProperty('pendingSyncCount');

      expect(typeof summary.globalEnabled).toBe('boolean');
      expect(typeof summary.perTracker).toBe('object');
      expect(typeof summary.envSet).toBe('boolean');
      expect(typeof summary.pendingSyncCount).toBe('number');
    });

    it('should detect environment variable', () => {
      process.env.SHADOW_MODE = 'true';

      const summary = getShadowModeSummary();
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
