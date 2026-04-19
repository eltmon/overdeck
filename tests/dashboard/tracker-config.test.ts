/**
 * Tests for initTrackerConfigCache() in src/dashboard/server/services/tracker-config.ts (PAN-446)
 *
 * initTrackerConfigCache() was changed to read ~/.panopticon.env asynchronously
 * via readFile from fs/promises (was previously sync readFileSync). These tests
 * verify cache population and fallback behavior.
 *
 * getLinearApiKey() checks config.yaml first, so we mock config-yaml to throw
 * (simulating no yaml config) so the function falls through to the env-file cache.
 * We also redirect homedir() to a temp dir via vi.doMock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'tracker-config-test-'));
  vi.resetModules();
  // Redirect homedir() to our temp dir so initTrackerConfigCache reads from there
  vi.doMock('os', () => ({
    homedir: () => testDir,
    tmpdir,
    platform: process.platform,
  }));
  // Make loadYamlConfig throw so getLinearApiKey falls through to the env-file cache
  vi.doMock('../../src/lib/config-yaml.js', () => ({
    loadConfig: () => { throw new Error('no yaml config in test'); },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(testDir, { recursive: true, force: true });
});

async function importTrackerConfig() {
  return import('../../src/dashboard/server/services/tracker-config.js');
}

describe('initTrackerConfigCache() — async env-file loading (PAN-446 regression)', () => {
  it('populates the cache from ~/.panopticon.env and getLinearApiKey() returns it', async () => {
    writeFileSync(join(testDir, '.panopticon.env'), 'LINEAR_API_KEY=test-key-from-envfile\n');

    const { initTrackerConfigCache, getLinearApiKey } = await importTrackerConfig();

    await initTrackerConfigCache();

    expect(getLinearApiKey()).toBe('test-key-from-envfile');
  });

  it('leaves cache null when ~/.panopticon.env does not exist', async () => {
    // No env file written; no process.env.LINEAR_API_KEY set
    const savedKey = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;

    try {
      const { initTrackerConfigCache, getLinearApiKey } = await importTrackerConfig();
      await initTrackerConfigCache();
      expect(getLinearApiKey()).toBeNull();
    } finally {
      if (savedKey !== undefined) process.env.LINEAR_API_KEY = savedKey;
    }
  });

  it('returns null for a key not present in the env file', async () => {
    writeFileSync(join(testDir, '.panopticon.env'), 'GITHUB_TOKEN=ghp_test\n');

    const savedKey = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;

    try {
      const { initTrackerConfigCache, getLinearApiKey } = await importTrackerConfig();
      await initTrackerConfigCache();
      expect(getLinearApiKey()).toBeNull();
    } finally {
      if (savedKey !== undefined) process.env.LINEAR_API_KEY = savedKey;
    }
  });

  it('does not throw when the env file is unreadable — falls back gracefully', async () => {
    // No .panopticon.env written; initTrackerConfigCache should not throw
    const { initTrackerConfigCache } = await importTrackerConfig();
    await expect(initTrackerConfigCache()).resolves.toBeUndefined();
  });
});
