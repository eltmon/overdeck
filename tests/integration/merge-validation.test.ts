import { Effect } from 'effect';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { runMergeValidation, autoRevertMerge } from '../../src/lib/cloister/validation.js';

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

  describe('clean merge scenario', () => {
    it('should validate a clean merge successfully', async () => {
      // Setup: Create validation script that passes
      const scriptPath = join(testRepo, 'scripts', 'validate-merge.sh');
      writeFileSync(
        scriptPath,
        `#!/bin/bash
echo "=== Merge Validation ==="
echo "Checking for conflict markers..."
echo "✓ No conflict markers found"
echo ""
echo "Running build..."
echo "✓ Build passed"
echo ""
echo "Running tests..."
echo "✓ Tests passed"
echo ""
echo "=== VALIDATION PASSED ==="
exit 0
`,
        { mode: 0o755 }
      );

      // Execute validation
      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-CLEAN',
      }));

      // Verify
      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.conflictMarkersFound).toBe(false);
      expect(result.buildPassed).toBe(true);
      expect(result.testsPassed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });
  });

  describe('merge with conflicts scenario', () => {
    it('should detect conflicts and fail validation', async () => {
      // Setup: Create script that reports conflicts
      const scriptPath = join(testRepo, 'scripts', 'validate-merge.sh');
      writeFileSync(
        scriptPath,
        `#!/bin/bash
echo "=== Merge Validation ==="
echo "Checking for conflict markers..."
echo "ERROR: Conflict start markers found in files:"
echo "src/conflicted-file.ts"
echo ""
echo "VALIDATION FAILED: Conflict markers detected"
exit 1
`,
        { mode: 0o755 }
      );

      // Execute validation
      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-CONFLICT',
      }));

      // Verify
      expect(result.success).toBe(true); // Script ran
      expect(result.valid).toBe(false); // But validation failed
      expect(result.conflictMarkersFound).toBe(true);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.failures[0].type).toBe('conflict');
    });
  });

  describe('build failure scenario', () => {
    it('should detect build failures', async () => {
      // Setup: Create script that reports build failure
      const scriptPath = join(testRepo, 'scripts', 'validate-merge.sh');
      writeFileSync(
        scriptPath,
        `#!/bin/bash
echo "=== Merge Validation ==="
echo "Checking for conflict markers..."
echo "✓ No conflict markers found"
echo ""
echo "Running build..."
echo "ERROR: Build failed"
echo ""
echo "VALIDATION FAILED: Build errors detected"
exit 1
`,
        { mode: 0o755 }
      );

      // Execute validation
      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-BUILD-FAIL',
      }));

      // Verify
      expect(result.valid).toBe(false);
      expect(result.conflictMarkersFound).toBe(false);
      expect(result.buildPassed).toBe(false);
      expect(result.failures).toContainEqual(
        expect.objectContaining({ type: 'build' })
      );
    });
  });

  describe('test failure scenario', () => {
    it('should detect test failures', async () => {
      // Setup: Create script that reports test failure
      const scriptPath = join(testRepo, 'scripts', 'validate-merge.sh');
      writeFileSync(
        scriptPath,
        `#!/bin/bash
echo "=== Merge Validation ==="
echo "Checking for conflict markers..."
echo "✓ No conflict markers found"
echo ""
echo "Running build..."
echo "✓ Build passed"
echo ""
echo "Running tests..."
echo "ERROR: Tests failed"
echo ""
echo "VALIDATION FAILED: Test failures detected"
exit 1
`,
        { mode: 0o755 }
      );

      // Execute validation
      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-TEST-FAIL',
      }));

      // Verify
      expect(result.valid).toBe(false);
      expect(result.testsPassed).toBe(false);
      expect(result.failures).toContainEqual(
        expect.objectContaining({ type: 'test' })
      );
    });
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

  describe('validation script missing', () => {
    it('should handle gracefully when validation script is missing', async () => {
      // No validation script created

      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-NO-SCRIPT',
      }));

      // No validation script = skip (specialist already ran build + tests)
      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.skipped).toBe(true);
    });
  });
});
