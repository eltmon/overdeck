/**
 * Tests for GET /api/version endpoint logic (PAN-234)
 *
 * The endpoint reads version from package.json at startup.
 * These tests verify the version-reading logic using temp files,
 * following the established pattern in tests/dashboard/health-api.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
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
 * Version reading logic extracted from src/dashboard/server/index.ts.
 * The server does this once at startup and caches the result.
 */
function readPackageVersion(pkgPath: string): string {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

describe('version-api', () => {
  describe('readPackageVersion', () => {
    it('returns the version string from a valid package.json', () => {
      const pkgPath = join(testDir, 'package.json');
      writeFileSync(pkgPath, JSON.stringify({ name: 'test', version: '1.2.3' }));

      expect(readPackageVersion(pkgPath)).toBe('1.2.3');
    });

    it('returns a semver-like version (digits and dots)', () => {
      const pkgPath = join(testDir, 'package.json');
      writeFileSync(pkgPath, JSON.stringify({ name: 'test', version: '0.4.32' }));

      const version = readPackageVersion(pkgPath);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('throws when package.json does not exist', () => {
      const missingPath = join(testDir, 'missing', 'package.json');
      expect(() => readPackageVersion(missingPath)).toThrow();
    });

    it('throws when package.json is not valid JSON', () => {
      const pkgPath = join(testDir, 'package.json');
      writeFileSync(pkgPath, 'not json {{{');
      expect(() => readPackageVersion(pkgPath)).toThrow();
    });
  });

  describe('root package.json', () => {
    it('has a valid semver version string', () => {
      // Verify the actual project package.json that the server reads at startup
      const rootPkgPath = join(__dirname, '..', '..', 'package.json');
      const version = readPackageVersion(rootPkgPath);

      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
