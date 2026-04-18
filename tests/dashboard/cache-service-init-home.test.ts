/**
 * Tests for CacheService.initHome() async home-dir bootstrap (PAN-446)
 *
 * initHome() creates PANOPTICON_HOME when missing, and is a no-op when it exists.
 * The module reads PANOPTICON_HOME at load time, so we use vi.resetModules() +
 * vi.stubEnv() to point it at a temp dir before importing.
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

describe('CacheService.initHome()', () => {
  it('creates PANOPTICON_HOME when it does not exist', async () => {
    expect(existsSync(panopticonHome)).toBe(false);

    const { CacheService } = await import('../../src/dashboard/server/services/cache-service.js');
    await CacheService.initHome();

    expect(existsSync(panopticonHome)).toBe(true);
  });

  it('is a no-op when PANOPTICON_HOME already exists', async () => {
    mkdirSync(panopticonHome, { recursive: true });
    const markerFile = join(panopticonHome, 'existing.txt');
    // Write a marker to confirm the dir is untouched
    require('fs').writeFileSync(markerFile, 'present');

    const { CacheService } = await import('../../src/dashboard/server/services/cache-service.js');
    await CacheService.initHome();

    expect(existsSync(panopticonHome)).toBe(true);
    expect(existsSync(markerFile)).toBe(true);
  });

  it('resolves without throwing when dir already exists', async () => {
    mkdirSync(panopticonHome, { recursive: true });

    const { CacheService } = await import('../../src/dashboard/server/services/cache-service.js');
    await expect(CacheService.initHome()).resolves.toBeUndefined();
  });
});
