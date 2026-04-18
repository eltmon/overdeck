/**
 * Tests for CacheService home-dir bootstrap (PAN-446)
 *
 * cache-service.ts uses a module-level top-level await to create PANOPTICON_HOME
 * before any constructor runs. This guarantees safety for every construction path,
 * not just the main.ts startup sequence.
 *
 * PANOPTICON_HOME is evaluated at module load time, so we use vi.resetModules() +
 * vi.stubEnv() to redirect it to a temp dir before each dynamic import.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;
let panopticonHome: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'cache-service-test-'));
  panopticonHome = join(testDir, '.panopticon');
  vi.resetModules();
  vi.stubEnv('PANOPTICON_HOME', panopticonHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(testDir, { recursive: true, force: true });
});

describe('CacheService module-level home-dir init', () => {
  it('creates PANOPTICON_HOME on import when it does not exist', async () => {
    expect(existsSync(panopticonHome)).toBe(false);

    // Importing the real module triggers the top-level await that creates the dir
    await import('../../src/dashboard/server/services/cache-service.js');

    expect(existsSync(panopticonHome)).toBe(true);
  });

  it('is a no-op when PANOPTICON_HOME already exists', async () => {
    mkdirSync(panopticonHome, { recursive: true });
    const marker = join(panopticonHome, 'sentinel.txt');
    require('fs').writeFileSync(marker, 'present');

    await import('../../src/dashboard/server/services/cache-service.js');

    expect(existsSync(marker)).toBe(true);
  });

  it('constructor succeeds after module import with missing dir', async () => {
    expect(existsSync(panopticonHome)).toBe(false);

    const { CacheService } = await import('../../src/dashboard/server/services/cache-service.js');
    // Dir was created by module-level await; constructor should not throw
    expect(() => new CacheService()).not.toThrow();
  });
});
