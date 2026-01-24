import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { runMergeValidation, autoRevertMerge } from '../../src/lib/cloister/validation.js';

const execAsync = promisify(exec);

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

  beforeEach(async () => {
    // Create a unique temp git repository for each test
    testRepo = join(tmpdir(), `pan-merge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testRepo, { recursive: true });

    // Initialize git repo
    await execAsync('git init', { cwd: testRepo });
    await execAsync('git config user.name "Test User"', { cwd: testRepo });
    await execAsync('git config user.email "test@example.com"', { cwd: testRepo });

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
      const result = await runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-CLEAN',
      });

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
      const result = await runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-CONFLICT',
      });

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
      const result = await runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-BUILD-FAIL',
      });

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
      const result = await runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-TEST-FAIL',
      });

      // Verify
      expect(result.valid).toBe(false);
      expect(result.testsPassed).toBe(false);
      expect(result.failures).toContainEqual(
        expect.objectContaining({ type: 'test' })
      );
    });
  });

  describe('auto-revert workflow', () => {
    it('should revert merge when validation fails', async () => {
      // Setup: Create initial commit
      writeFileSync(join(testRepo, 'file1.txt'), 'initial content');
      await execAsync('git add .', { cwd: testRepo });
      await execAsync('git commit -m "Initial commit"', { cwd: testRepo });

      const { stdout: beforeMerge } = await execAsync('git rev-parse HEAD', { cwd: testRepo });
      const initialCommit = beforeMerge.trim();

      // Simulate merge by creating another commit
      writeFileSync(join(testRepo, 'merged.txt'), 'merged content');
      await execAsync('git add .', { cwd: testRepo });
      await execAsync('git commit -m "Merge branch feature"', { cwd: testRepo });

      const { stdout: afterMerge } = await execAsync('git rev-parse HEAD', { cwd: testRepo });
      const mergeCommit = afterMerge.trim();

      // Verify merge happened
      expect(mergeCommit).not.toBe(initialCommit);

      // Execute auto-revert
      const revertSuccess = await autoRevertMerge(testRepo);

      // Verify
      expect(revertSuccess).toBe(true);

      const { stdout: afterRevert } = await execAsync('git rev-parse HEAD', { cwd: testRepo });
      const revertedCommit = afterRevert.trim();

      expect(revertedCommit).toBe(initialCommit);
      expect(existsSync(join(testRepo, 'merged.txt'))).toBe(false);
    });
  });

  describe('validation script missing', () => {
    it('should handle gracefully when validation script is missing', async () => {
      // No validation script created

      const result = await runMergeValidation({
        projectPath: testRepo,
        issueId: 'TEST-NO-SCRIPT',
      });

      // Verify
      expect(result.success).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Validation script not found');
    });
  });
});
