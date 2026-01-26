import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { cleanupStaleLocks, hasStaleLocks } from '../../src/lib/git-utils';

const execAsync = promisify(exec);

describe('git-utils', () => {
  let testRepoPath: string;

  beforeEach(async () => {
    // Create a temporary git repository for testing
    testRepoPath = join(tmpdir(), `panopticon-git-utils-test-${Date.now()}`);
    mkdirSync(testRepoPath, { recursive: true });

    // Initialize a git repo
    await execAsync('git init', { cwd: testRepoPath });
    await execAsync('git config user.email "test@example.com"', { cwd: testRepoPath });
    await execAsync('git config user.name "Test User"', { cwd: testRepoPath });

    // Create an initial commit
    writeFileSync(join(testRepoPath, 'README.md'), '# Test Repo\n');
    await execAsync('git add .', { cwd: testRepoPath });
    await execAsync('git commit -m "Initial commit"', { cwd: testRepoPath });

    // Wait a bit to ensure git processes finish
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(() => {
    // Clean up test repo
    if (existsSync(testRepoPath)) {
      rmSync(testRepoPath, { recursive: true, force: true });
    }
  });

  describe('cleanupStaleLocks', () => {
    it('should detect and remove stale index.lock', async () => {
      // Create a fake stale lock file
      const lockFile = join(testRepoPath, '.git', 'index.lock');
      writeFileSync(lockFile, '');

      // Verify lock exists
      expect(existsSync(lockFile)).toBe(true);

      // Run cleanup
      const result = await cleanupStaleLocks(testRepoPath);

      // Debug output
      console.log('Cleanup result:', JSON.stringify(result, null, 2));

      // Should find and remove the lock
      expect(result.found).toContain(lockFile);
      expect(result.removed).toContain(lockFile);
      expect(result.errors).toHaveLength(0);

      // Lock should be gone
      expect(existsSync(lockFile)).toBe(false);
    });

    it('should return empty arrays when no locks exist', async () => {
      const result = await cleanupStaleLocks(testRepoPath);

      expect(result.found).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect multiple lock files', async () => {
      // Create multiple lock files
      const indexLock = join(testRepoPath, '.git', 'index.lock');
      const refLock = join(testRepoPath, '.git', 'refs', 'heads', 'main.lock');

      writeFileSync(indexLock, '');

      // Ensure refs/heads directory exists
      const refsHeadsDir = join(testRepoPath, '.git', 'refs', 'heads');
      if (!existsSync(refsHeadsDir)) {
        mkdirSync(refsHeadsDir, { recursive: true });
      }
      writeFileSync(refLock, '');

      const result = await cleanupStaleLocks(testRepoPath);

      expect(result.found.length).toBeGreaterThanOrEqual(2);
      expect(result.removed.length).toBeGreaterThanOrEqual(2);
      expect(existsSync(indexLock)).toBe(false);
      expect(existsSync(refLock)).toBe(false);
    });
  });

  describe('hasStaleLocks', () => {
    it('should return false when no locks exist', async () => {
      const result = await hasStaleLocks(testRepoPath);
      expect(result).toBe(false);
    });

    it('should return true when stale locks exist', async () => {
      // Create a fake stale lock file
      const lockFile = join(testRepoPath, '.git', 'index.lock');
      writeFileSync(lockFile, '');

      const result = await hasStaleLocks(testRepoPath);
      expect(result).toBe(true);

      // Clean up
      rmSync(lockFile);
    });
  });
});
