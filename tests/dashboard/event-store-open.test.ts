/**
 * Tests for openEventDb() in src/dashboard/server/event-store.ts (PAN-446)
 *
 * openEventDb() was changed to async-create OVERDECK_HOME via mkdir from
 * fs/promises (was previously sync mkdirSync). These tests verify the async
 * home-dir creation path using a redirected OVERDECK_HOME env var.
 *
 * getOverdeckHome() reads process.env.OVERDECK_HOME on each call, so
 * vi.stubEnv() is sufficient — no module reset needed.
 *
 * Under Node (Vitest runtime), openEventDb() delegates DB open to getDatabase()
 * after the home-dir creation step. The dir creation is verified; DB-open
 * failures in the isolated test env are caught and ignored.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openEventDb } from '../../src/dashboard/server/event-store.js';

let testDir: string;
let overdeckHome: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'event-store-test-'));
  overdeckHome = join(testDir, '.overdeck');
  vi.stubEnv('OVERDECK_HOME', overdeckHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(testDir, { recursive: true, force: true });
});

describe('openEventDb() — async home-dir creation (PAN-446 regression)', () => {
  it('creates OVERDECK_HOME when it does not exist', async () => {
    expect(existsSync(overdeckHome)).toBe(false);

    // DB open may fail in isolated test env; the dir creation runs first
    try { await openEventDb(); } catch { /* ignore DB open failure */ }

    expect(existsSync(overdeckHome)).toBe(true);
  });

  it('leaves OVERDECK_HOME intact when it already exists', async () => {
    mkdirSync(overdeckHome, { recursive: true });
    const sentinel = join(overdeckHome, 'sentinel.txt');
    require('fs').writeFileSync(sentinel, 'present');

    try { await openEventDb(); } catch { /* ignore DB open failure */ }

    // Dir must still exist and contents must be untouched
    expect(existsSync(overdeckHome)).toBe(true);
    expect(existsSync(sentinel)).toBe(true);
  });
});
