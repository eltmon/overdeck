import { Effect } from 'effect';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { autoRevertMerge } from '../../src/lib/cloister/validation.js';

const execAsync = promisify(exec);
const testFileDir = dirname(fileURLToPath(import.meta.url));
let hostRepoRoot: string;

async function resolveGitRoot(targetDir: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: targetDir,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function assertNotHostRepo(targetDir: string) {
  const targetRoot = await resolveGitRoot(targetDir) ?? resolve(targetDir);
  if (targetRoot === hostRepoRoot) {
    throw new Error(`SAFETY: refusing to run destructive git op against the host repo at ${hostRepoRoot}`);
  }
}

async function gitRead(repoDir: string, command: string) {
  return execAsync(`git ${command}`, { cwd: repoDir });
}

async function gitMutate(repoDir: string, command: string) {
  await assertNotHostRepo(repoDir);
  return execAsync(`git ${command}`, { cwd: repoDir });
}

/**
 * Integration tests for merge validation workflow
 *
 * These tests verify the end-to-end validation flow:
 * 1. Validation script execution
 * 2. Result parsing
 * 3. Auto-revert on failure
 */
describe('merge-validation integration', () => {
  let testRepo: string;

  beforeAll(async () => {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: testFileDir,
    });
    hostRepoRoot = stdout.trim();
  });

  beforeEach(async () => {
    // Create a unique temp git repository for each test
    testRepo = mkdtempSync(join(tmpdir(), 'pan-mv-'));

    // Initialize git repo
    await gitMutate(testRepo, 'init');
    await gitMutate(testRepo, 'config user.name "Test User"');
    await gitMutate(testRepo, 'config user.email "test@example.com"');

    // Create validation script
    const scriptDir = join(testRepo, 'scripts');
    mkdirSync(scriptDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testRepo)) {
      rmSync(testRepo, { recursive: true, force: true });
    }
  });

  describe('auto-revert workflow', () => {
    it('should refuse to target the host repo', async () => {
      await expect(assertNotHostRepo(hostRepoRoot)).rejects.toThrow(
        `SAFETY: refusing to run destructive git op against the host repo at ${hostRepoRoot}`
      );
    });

    it('should revert merge when validation fails', async () => {
      // Setup: Create initial commit on main
      writeFileSync(join(testRepo, 'file1.txt'), 'initial content');
      await gitMutate(testRepo, 'add .');
      await gitMutate(testRepo, 'commit -m "Initial commit"');

      const { stdout: beforeMerge } = await gitRead(testRepo, 'rev-parse HEAD');
      const initialCommit = beforeMerge.trim();

      // Create a feature branch with a commit
      await gitMutate(testRepo, 'switch -c feature-test');
      writeFileSync(join(testRepo, 'merged.txt'), 'merged content');
      await gitMutate(testRepo, 'add .');
      await gitMutate(testRepo, 'commit -m "Feature commit"');

      // Merge back to main (sets ORIG_HEAD)
      await gitMutate(testRepo, 'switch -');
      await gitMutate(testRepo, 'merge feature-test --no-ff -m "Merge branch feature-test"');

      const { stdout: afterMerge } = await gitRead(testRepo, 'rev-parse HEAD');
      const mergeCommit = afterMerge.trim();

      // Verify merge happened
      expect(mergeCommit).not.toBe(initialCommit);

      // Execute auto-revert (uses ORIG_HEAD)
      await assertNotHostRepo(testRepo);
      await expect(Effect.runPromise(autoRevertMerge(testRepo))).resolves.toBeUndefined();

      const { stdout: afterRevert } = await gitRead(testRepo, 'rev-parse HEAD');
      const revertedCommit = afterRevert.trim();

      expect(revertedCommit).toBe(initialCommit);
      expect(existsSync(join(testRepo, 'merged.txt'))).toBe(false);
    });
  });
});
