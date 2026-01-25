import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runMergeValidation, autoRevertMerge } from '../../../../src/lib/cloister/validation.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('validation', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `panopticon-validation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('runMergeValidation', () => {
    it('should return error when validation script does not exist', async () => {
      const result = await runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      });

      expect(result.success).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Validation script not found');
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

      const result = await runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      });

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

      const result = await runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      });

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

      const result = await runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      });

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

      const result = await runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      });

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

      const result = await runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      });

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

      const result = await runMergeValidation({
        projectPath: testDir,
        issueId: 'TEST-1',
      });

      expect(result.valid).toBe(true);
      expect(result.buildPassed).toBe(null); // Skipped, not passed or failed
      expect(result.testsPassed).toBe(null); // Skipped
    });
  });

  describe('autoRevertMerge', () => {
    it('should revert last commit when successful', async () => {
      // Initialize git repo
      await execAsync('git init', { cwd: testDir });
      await execAsync('git config user.name "Test"', { cwd: testDir });
      await execAsync('git config user.email "test@test.com"', { cwd: testDir });

      // Create initial commit
      writeFileSync(join(testDir, 'file1.txt'), 'initial content');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Initial commit"', { cwd: testDir });

      const { stdout: commit1 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const beforeCommit = commit1.trim();

      // Create second commit (simulating merge)
      writeFileSync(join(testDir, 'file2.txt'), 'merged content');
      await execAsync('git add .', { cwd: testDir });
      await execAsync('git commit -m "Merge commit"', { cwd: testDir });

      // Verify we have 2 commits
      const { stdout: commit2 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const afterCommit = commit2.trim();
      expect(afterCommit).not.toBe(beforeCommit);

      // Revert
      const success = await autoRevertMerge(testDir);

      expect(success).toBe(true);

      // Verify HEAD is back to first commit
      const { stdout: commit3 } = await execAsync('git rev-parse HEAD', { cwd: testDir });
      const revertedCommit = commit3.trim();
      expect(revertedCommit).toBe(beforeCommit);

      // Verify file2.txt is gone
      expect(existsSync(join(testDir, 'file2.txt'))).toBe(false);
    });

    it('should return false when git command fails', async () => {
      // Non-git directory
      const success = await autoRevertMerge(testDir);

      expect(success).toBe(false);
    });
  });
});
