import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runMergeValidation, autoRevertMerge, runQualityGates } from '../../../../src/lib/cloister/validation.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('validation', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `overdeck-validation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('runMergeValidation', () => {
    it('should return skipped when validation script does not exist', async () => {
      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      }));

      // No validation script = skip (specialist already ran build + tests)
      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('should return success when validation script passes', async () => {
      // Create a simple passing validation script
      const scriptPath = join(testDir, 'scripts', 'validate-merge.sh');
      mkdirSync(join(testDir, 'scripts'), { recursive: true });
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

      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      }));

      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.conflictMarkersFound).toBe(false);
      expect(result.buildPassed).toBe(true);
      expect(result.testsPassed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('should detect conflict markers and return failure', async () => {
      const scriptPath = join(testDir, 'scripts', 'validate-merge.sh');
      mkdirSync(join(testDir, 'scripts'), { recursive: true });
      writeFileSync(
        scriptPath,
        `#!/bin/bash
echo "=== Merge Validation ==="
echo "Checking for conflict markers..."
echo "ERROR: Conflict start markers found in files:"
echo "src/file1.ts"
echo "src/file2.ts"
echo ""
echo "VALIDATION FAILED: Conflict markers detected"
exit 1
`,
        { mode: 0o755 }
      );

      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      }));

      expect(result.success).toBe(true); // Script ran successfully
      expect(result.valid).toBe(false); // But validation failed
      expect(result.conflictMarkersFound).toBe(true);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].type).toBe('conflict');
      expect(result.failures[0].files).toContain('src/file1.ts');
      expect(result.failures[0].files).toContain('src/file2.ts');
    });

    it('should detect build failure', async () => {
      const scriptPath = join(testDir, 'scripts', 'validate-merge.sh');
      mkdirSync(join(testDir, 'scripts'), { recursive: true });
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

      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      }));

      expect(result.valid).toBe(false);
      expect(result.conflictMarkersFound).toBe(false);
      expect(result.buildPassed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].type).toBe('build');
    });

    it('should detect test failure', async () => {
      const scriptPath = join(testDir, 'scripts', 'validate-merge.sh');
      mkdirSync(join(testDir, 'scripts'), { recursive: true });
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

      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      }));

      expect(result.valid).toBe(false);
      expect(result.conflictMarkersFound).toBe(false);
      expect(result.buildPassed).toBe(true);
      expect(result.testsPassed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].type).toBe('test');
    });

    it('should handle multiple failures', async () => {
      const scriptPath = join(testDir, 'scripts', 'validate-merge.sh');
      mkdirSync(join(testDir, 'scripts'), { recursive: true });
      writeFileSync(
        scriptPath,
        `#!/bin/bash
echo "=== Merge Validation ==="
echo "Checking for conflict markers..."
echo "ERROR: Conflict start markers found in files:"
echo "src/conflict.ts"
echo ""
echo "Running build..."
echo "ERROR: Build failed"
echo ""
echo "Running tests..."
echo "⚠ skipping test check"
echo ""
echo "VALIDATION FAILED"
exit 1
`,
        { mode: 0o755 }
      );

      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      }));

      expect(result.valid).toBe(false);
      expect(result.failures).toHaveLength(2); // conflict + build
      expect(result.failures.map(f => f.type)).toContain('conflict');
      expect(result.failures.map(f => f.type)).toContain('build');
    });

    it('should handle skipped build/tests gracefully', async () => {
      const scriptPath = join(testDir, 'scripts', 'validate-merge.sh');
      mkdirSync(join(testDir, 'scripts'), { recursive: true });
      writeFileSync(
        scriptPath,
        `#!/bin/bash
echo "=== Merge Validation ==="
echo "Checking for conflict markers..."
echo "✓ No conflict markers found"
echo ""
echo "Running build..."
echo "⚠ No build system detected (no package.json or pom.xml), skipping build check"
echo ""
echo "Running tests..."
echo "⚠ No test system detected, skipping test check"
echo ""
echo "=== VALIDATION PASSED ==="
exit 0
`,
        { mode: 0o755 }
      );

      const result = await Effect.runPromise(runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      }));

      expect(result.valid).toBe(true);
      expect(result.buildPassed).toBe(null); // Skipped, not passed or failed
      expect(result.testsPassed).toBe(null); // Skipped
    });
  });

  describe('runQualityGates', () => {
    it('preserves stdout failure details when trailing stderr noise exceeds its budget', async () => {
      const scriptPath = join(testDir, 'failing-gate.sh');
      writeFileSync(
        scriptPath,
        `#!/bin/bash
echo "FAIL src/example.test.ts > reports the actual assertion"
echo "AssertionError: expected true to be false"
for i in {1..500}; do echo "stdout filler $i"; done
for i in {1..500}; do echo "hint: noisy git advice $i" >&2; done
echo "stderr diagnostic survives too" >&2
exit 1
`,
        { mode: 0o755 },
      );

      const [result] = await Effect.runPromise(runQualityGates({
        test: { command: scriptPath },
      }, testDir));

      expect(result.passed).toBe(false);
      expect(result.output).toContain('FAIL src/example.test.ts');
      expect(result.output).toContain('AssertionError: expected true to be false');
      expect(result.output).toContain('stderr diagnostic survives too');
      expect(result.output).not.toContain('hint: noisy git advice');
      expect(result.output).toContain('chars elided');
    });

    it('uses the same separate stream budgets for passing gates', async () => {
      const scriptPath = join(testDir, 'passing-gate.sh');
      writeFileSync(
        scriptPath,
        `#!/bin/bash
echo "pass output starts here"
for i in {1..500}; do echo "stdout filler $i"; done
for i in {1..500}; do echo "warning: noisy tooling chatter $i" >&2; done
echo "pass stderr diagnostic" >&2
`,
        { mode: 0o755 },
      );

      const [result] = await Effect.runPromise(runQualityGates({
        test: { command: scriptPath },
      }, testDir));

      expect(result.passed).toBe(true);
      expect(result.output).toContain('pass output starts here');
      expect(result.output).toContain('pass stderr diagnostic');
      expect(result.output).not.toContain('warning: noisy tooling chatter');
    });
  });

  describe('autoRevertMerge', () => {
    it('should revert last commit when successful', async () => {
      // Initialize git repo with a real merge so ORIG_HEAD is set
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.name "Test"', { cwd: testDir });
      await execAsync('git config user.email "test@test.com"', { cwd: testDir });

      // Create initial commit on main
      writeFileSync(join(testDir, 'file1.txt'), 'initial content');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      const { stdout: commit1 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const beforeCommit = commit1.trim();

      // Create a feature branch with a commit
      await execAsync('git checkout -b feature-test', { cwd: testDir });
      writeFileSync(join(testDir, 'file2.txt'), 'merged content');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Feature commit"', { cwd: testDir });

      // Merge feature branch back to main (sets ORIG_HEAD)
      await execAsync('git checkout -', { cwd: testDir });
      await execAsync('git merge feature-test --no-ff -m "Merge feature-test"', { cwd: testDir });

      // Verify we advanced past the initial commit
      const { stdout: commit2 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const afterCommit = commit2.trim();
      expect(afterCommit).not.toBe(beforeCommit);

      // Revert using ORIG_HEAD
      await expect(Effect.runPromise(autoRevertMerge(testDir))).resolves.toBeUndefined();

      // Verify HEAD is back to first commit
      const { stdout: commit3 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const revertedCommit = commit3.trim();
      expect(revertedCommit).toBe(beforeCommit);

      // Verify file2.txt is gone
      expect(existsSync(join(testDir, 'file2.txt'))).toBe(false);
    });

    it('should fail when git command fails', async () => {
      // Non-git directory
      await expect(Effect.runPromise(autoRevertMerge(testDir))).rejects.toMatchObject({
        _tag: 'GitError',
      });
    });
  });
});
