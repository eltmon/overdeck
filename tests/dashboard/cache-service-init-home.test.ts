/**
 * Tests for CacheService constructor home-dir bootstrap (PAN-446)
 *
 * The constructor ensures PANOPTICON_HOME exists before opening cache.db,
 * so that any construction path (not just main.ts startup) is safe when
 * the directory has not yet been created.
 *
 * PANOPTICON_HOME is read at module-load time, so we use vi.resetModules() +
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

describe('CacheService constructor with missing PANOPTICON_HOME', () => {
  it('creates PANOPTICON_HOME when it does not exist before opening the database', async () => {
    expect(existsSync(panopticonHome)).toBe(false);

    const { CacheService } = await import('../../src/dashboard/server/services/cache-service.js');
    // Construction must not throw even when the directory is absent
    expect(() => new CacheService()).not.toThrow();

    expect(existsSync(panopticonHome)).toBe(true);
  });

  it('constructs successfully when PANOPTICON_HOME already exists', async () => {
    mkdirSync(panopticonHome, { recursive: true });

    const { CacheService } = await import('../../src/dashboard/server/services/cache-service.js');
    expect(() => new CacheService()).not.toThrow();
  });

  it('is safe to construct multiple times (idempotent dir creation)', async () => {
    const { CacheService } = await import('../../src/dashboard/server/services/cache-service.js');

    expect(() => {
      new CacheService();
      new CacheService();
    }).not.toThrow();

    expect(existsSync(panopticonHome)).toBe(true);
  });
});
