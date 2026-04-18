/**
 * Tests for CacheService home-dir bootstrap (PAN-446)
 *
 * PANOPTICON_HOME is created by main.ts at startup (await mkdir) before any
 * CacheService is constructed. These tests verify:
 *   1. CacheService constructor succeeds when the dir pre-exists.
 *   2. cache-service.ts has no top-level await — this is a production blocker because
 *      issue-service-singleton.ts statically imports cache-service, and routes/issues.ts +
 *      routes/misc.ts load issue-service-singleton via require() to break circular imports.
 *      If cache-service.ts has top-level await it becomes an async ESM module, causing
 *      ERR_REQUIRE_ASYNC_MODULE when those require() calls execute.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

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

describe('CacheService constructor', () => {
  it('succeeds when PANOPTICON_HOME already exists (normal path after main.ts mkdir)', async () => {
    mkdirSync(panopticonHome, { recursive: true });

    const { CacheService } = await import('../../src/dashboard/server/services/cache-service.js');
    let svc: InstanceType<typeof CacheService> | undefined;
    expect(() => { svc = new CacheService(); }).not.toThrow();
    svc?.close();
  });

  it('does NOT create PANOPTICON_HOME on import (no top-level await side-effects)', async () => {
    expect(existsSync(panopticonHome)).toBe(false);

    // Importing should NOT create the dir — main.ts owns that responsibility
    await import('../../src/dashboard/server/services/cache-service.js');

    expect(existsSync(panopticonHome)).toBe(false);
  });
});

describe('CacheService sync require() integration', () => {
  it('cache-service.ts has no top-level await (prevents ERR_REQUIRE_ASYNC_MODULE in require() chain)', () => {
    // If this module has top-level await, it becomes async ESM.
    // issue-service-singleton.ts statically imports cache-service, so it also becomes async.
    // routes/issues.ts:65 and routes/misc.ts:114 call require(issue-service-singleton) to
    // break circular imports — those require() calls throw ERR_REQUIRE_ASYNC_MODULE if
    // cache-service has top-level await.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/dashboard/server/services/cache-service.ts'),
      'utf-8'
    );
    // Track brace depth so we only flag `await` at module scope (depth 0).
    let depth = 0;
    const topLevelAwaits: string[] = [];
    for (const line of src.split('\n')) {
      // Strip line comments and string literals to avoid false positives
      const stripped = line.replace(/\/\/.*$/, '');
      for (const ch of stripped) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (depth === 0 && /\bawait\b/.test(stripped)) {
        topLevelAwaits.push(line.trim());
      }
    }
    expect(topLevelAwaits).toHaveLength(0);
  });
});
