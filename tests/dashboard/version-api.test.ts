/**
 * Tests for GET /api/version endpoint logic (PAN-234, PAN-446)
 *
 * The endpoint reads version from package.json at startup using async readFile.
 * These tests verify the async version-reading logic using temp files,
 * following the established pattern in tests/dashboard/health-api.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'version-api-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/**
 * Async version-reading logic matching src/dashboard/server/routes/misc.ts.
 * The server does this once at module load (top-level await) and caches the result.
 */
async function readPackageVersion(pkgPath: string): Promise<string> {
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  return pkg.version;
}

describe('version-api', () => {
  describe('readPackageVersion (async)', () => {
    it('returns the version string from a valid package.json', async () => {
      const pkgPath = join(testDir, 'package.json');
      writeFileSync(pkgPath, JSON.stringify({ name: 'test', version: '1.2.3' }));

      expect(await readPackageVersion(pkgPath)).toBe('1.2.3');
    });

    it('returns a semver-like version (digits and dots)', async () => {
      const pkgPath = join(testDir, 'package.json');
      writeFileSync(pkgPath, JSON.stringify({ name: 'test', version: '0.4.32' }));

      const version = await readPackageVersion(pkgPath);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('rejects when package.json does not exist', async () => {
      const missingPath = join(testDir, 'missing', 'package.json');
      await expect(readPackageVersion(missingPath)).rejects.toThrow();
    });

    it('rejects when package.json is not valid JSON', async () => {
      const pkgPath = join(testDir, 'package.json');
      writeFileSync(pkgPath, 'not json {{{');
      await expect(readPackageVersion(pkgPath)).rejects.toThrow();
    });
  });

  describe('root package.json', () => {
    it('has a valid semver version string', async () => {
      // Verify the actual project package.json that the server reads at startup
      const rootPkgPath = join(__dirname, '..', '..', 'package.json');
      const version = await readPackageVersion(rootPkgPath);

      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
