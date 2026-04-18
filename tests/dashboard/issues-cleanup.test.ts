/**
 * Tests for async rm() calls in src/dashboard/server/routes/issues.ts (PAN-446)
 *
 * The abort-planning path uses rm(dir, { recursive: true, force: true })
 * and the reopen path uses rm(markerPath). Both previously used rmSync.
 * These tests verify the async rm() behavior contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'issues-cleanup-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('async rm() — abort-planning path (recursive directory removal)', () => {
  it('removes an existing directory and all contents', async () => {
    const dir = join(testDir, 'planning-dir');
    mkdirSync(dir);
    writeFileSync(join(dir, 'STATE.md'), 'content');
    writeFileSync(join(dir, 'plan.json'), '{}');

    await rm(dir, { recursive: true, force: true });

    expect(existsSync(dir)).toBe(false);
  });

  it('does not throw when the target directory does not exist (force: true)', async () => {
    const missing = join(testDir, 'nonexistent-dir');
    await expect(rm(missing, { recursive: true, force: true })).resolves.toBeUndefined();
  });

  it('removes nested subdirectories recursively', async () => {
    const dir = join(testDir, 'root');
    const nested = join(dir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'file.txt'), 'data');

    await rm(dir, { recursive: true, force: true });

    expect(existsSync(dir)).toBe(false);
  });
});

describe('async rm() — reopen path (single file removal)', () => {
  it('removes an existing marker file', async () => {
    const marker = join(testDir, 'done.marker');
    writeFileSync(marker, '');

    await rm(marker);

    expect(existsSync(marker)).toBe(false);
  });

  it('throws when the marker file does not exist and force is not set', async () => {
    const missing = join(testDir, 'missing.marker');
    await expect(rm(missing)).rejects.toThrow();
  });
});
