import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const admissionMocks = vi.hoisted(() => ({
  release: vi.fn(async () => undefined),
  acquire: vi.fn(async () => ({
    admittedAt: '2026-07-19T00:00:00.000Z',
    release: async () => admissionMocks.release(),
  })),
}));

vi.mock('../../../../src/lib/cloister/quality-gate-admission.js', () => ({
  acquireQualityGateAdmission: admissionMocks.acquire,
}));

import { autoRevertMerge, runQualityGates } from '../../../../src/lib/cloister/validation.js';
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

  describe('runQualityGates', () => {
    it('preserves the complete failed gate output', async () => {
      const scriptPath = join(testDir, 'failing-gate.sh');
      writeFileSync(
        scriptPath,
        `#!/bin/bash
for i in {1..500}; do echo "leading stdout $i"; done
echo "FAIL src/example.test.ts > reports the actual assertion"
echo "AssertionError: expected true to be false"
for i in {1..500}; do echo "trailing stdout $i"; done
for i in {1..500}; do echo "hint: noisy git advice $i" >&2; done
echo "final stderr diagnostic" >&2
exit 1
`,
        { mode: 0o755 },
      );

      const [result] = await runQualityGates({
        test: { command: scriptPath },
      }, testDir);

      expect(result.passed).toBe(false);
      expect(result.output).toContain('leading stdout 1');
      expect(result.output).toContain('FAIL src/example.test.ts > reports the actual assertion');
      expect(result.output).toContain('AssertionError: expected true to be false');
      expect(result.output).toContain('trailing stdout 500');
      expect(result.output).toContain('hint: noisy git advice 1');
      expect(result.output).toContain('final stderr diagnostic');
      expect(result.output).not.toContain('chars elided');
    });

    it('keeps passing gate output clipped to the existing preview budgets', async () => {
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

      const [result] = await runQualityGates({
        test: { command: scriptPath },
      }, testDir);

      expect(result.passed).toBe(true);
      expect(result.output).toContain('pass output starts here');
      expect(result.output).toContain('pass stderr diagnostic');
      expect(result.output).not.toContain('warning: noisy tooling chatter');
      expect(result.output).toContain('chars elided');
    });
  });

  describe('runQualityGates shouldStop (PAN-4531)', () => {
    it('a run decided after the first gate never asks for CPU admission again', async () => {
      admissionMocks.acquire.mockClear();
      let decided = false;
      const results = await runQualityGates({
        typecheck: { command: 'true' },
        lint: { command: 'true' },
      }, testDir, 'pre_push', {
        onGateResult: () => { decided = true; },
        shouldStop: async () => decided,
      });

      expect(results.map((r) => r.name)).toEqual(['typecheck']);
      expect(admissionMocks.acquire).toHaveBeenCalledTimes(1);
      expect(admissionMocks.release).toHaveBeenCalled();
    });

    it('a run decided while the gate waited for admission releases the slot without running the command', async () => {
      admissionMocks.acquire.mockClear();
      admissionMocks.release.mockClear();
      let checks = 0;
      const results = await runQualityGates({
        lint: { command: 'false' },
      }, testDir, 'pre_push', {
        // false at the top of the gate, true once admitted
        shouldStop: async () => ++checks > 1,
      });

      expect(results).toEqual([]);
      expect(admissionMocks.acquire).toHaveBeenCalledTimes(1);
      expect(admissionMocks.release).toHaveBeenCalledTimes(1);
    });

    it('a run decided between retries does not queue the next attempt', async () => {
      admissionMocks.acquire.mockClear();
      let checks = 0;
      const results = await runQualityGates({
        test: { command: 'false', retry: 2 },
      }, testDir, 'pre_push', {
        // top of the gate, after admission, then before the first retry
        shouldStop: async () => ++checks > 2,
      });

      expect(results).toEqual([]);
      expect(admissionMocks.acquire).toHaveBeenCalledTimes(1);
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
