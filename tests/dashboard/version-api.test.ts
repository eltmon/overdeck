/**
 * Tests for readPackageVersion() in src/dashboard/server/routes/misc.ts (PAN-446)
 *
 * readPackageVersion() is the async function that walks up the directory tree to
 * find and read package.json. It was converted from sync (readFileSync) to async
 * (readFile from fs/promises). These tests import the real production function.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readPackageVersion } from '../../src/dashboard/server/routes/misc.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'version-api-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('readPackageVersion() — async production function from misc.ts', () => {
  it('returns a non-empty semver-like string from the real package.json', async () => {
    const version = await readPackageVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns a real version, not the 0.0.0 fallback', async () => {
    const version = await readPackageVersion();
    expect(version).not.toBe('0.0.0');
  });

  it('is async — returns a Promise (regression against sync readFileSync)', () => {
    const result = readPackageVersion();
    expect(result).toBeInstanceOf(Promise);
    return result;
  });
});
