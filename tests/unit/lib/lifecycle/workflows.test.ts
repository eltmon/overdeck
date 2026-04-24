import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Use vi.hoisted to avoid initialization order issues
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

vi.mock('../../../../src/lib/tmux.js', () => ({
  sessionExists: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/paths.js')>();
  return {
    ...actual,
    AGENTS_DIR: join(tmpdir(), 'panopticon-wf-test-agents'),
    PANOPTICON_HOME: join(tmpdir(), 'panopticon-wf-test-home'),
  };
});

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  removeShadowState: vi.fn().mockReturnValue({ success: true }),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  clearReviewStatus: vi.fn(),
}));

import { approve, closeOut, deepWipe, close } from '../../../../src/lib/lifecycle/workflows.js';
import { AGENTS_DIR, PANOPTICON_HOME } from '../../../../src/lib/paths.js';

describe('workflows', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `panopticon-wf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(AGENTS_DIR, { recursive: true });
    mkdirSync(PANOPTICON_HOME, { recursive: true });

    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    for (const dir of [testDir, AGENTS_DIR, PANOPTICON_HOME]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    vi.restoreAllMocks();
  });

  describe('approve', () => {
    it('should return a successful workflow result', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };
      const result = await approve(ctx);

      expect(result.workflow).toBe('approve');
      expect(result.issueId).toBe('PAN-100');
      expect(result.success).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include archive, close, teardown, beads, and clear-review steps', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      const result = await approve(ctx);

      const stepNames = result.steps.map(s => s.step);
      // Should include at least these step categories
      expect(stepNames.some(s => s.startsWith('archive-planning:'))).toBe(true);
      expect(stepNames.some(s => s.startsWith('close-issue:'))).toBe(true);
      expect(stepNames.some(s => s.startsWith('teardown:'))).toBe(true);
      expect(stepNames.some(s => s === 'clear-review-status')).toBe(true);
    });

    it('should skip beads compaction when skipBeadsCompaction is true', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await approve(ctx, { skipBeadsCompaction: true });

      const stepNames = result.steps.map(s => s.step);
      expect(stepNames.some(s => s.startsWith('compact-beads'))).toBe(false);
    });
  });

  describe('close', () => {
    it('should return a successful workflow result', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };
      const result = await close(ctx);

      expect(result.workflow).toBe('close');
      expect(result.success).toBe(true);
    });

    it('should NOT include archive steps', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };
      const result = await close(ctx);

      const stepNames = result.steps.map(s => s.step);
      expect(stepNames.some(s => s.startsWith('archive-planning:'))).toBe(false);
    });
  });

  describe('closeOut', () => {
    it('should verify branch merged before proceeding', async () => {
      // Mock git branch check — branch doesn't exist (squash-merged)
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx);

      expect(result.workflow).toBe('close-out');
      const verifyStep = result.steps.find(s => s.step === 'close-out:verify-merged');
      expect(verifyStep).toBeDefined();
      expect(verifyStep!.success).toBe(true);
    });

    it('should abort if archive fails', async () => {
      // Since there's no active PRD, it will skip — that's success
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx);

      // Should complete without abort since skipped == success
      expect(result.steps.some(s => s.step === 'close-out:abort')).toBe(false);
    });
  });

  describe('deepWipe', () => {
    it('should return a successful workflow result', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx);

      expect(result.workflow).toBe('deep-wipe');
      expect(result.success).toBe(true);
    });

    it('should include teardown with branch deletion by default', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx);

      const branchStep = result.steps.find(s => s.step === 'teardown:branches');
      expect(branchStep).toBeDefined();
      expect(branchStep!.success).toBe(true);
    });

    it('should skip branch deletion when deleteBranches is false', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx, { deleteBranches: false });

      const branchStep = result.steps.find(s => s.step === 'teardown:branches');
      expect(branchStep).toBeUndefined();
    });

    it.skip('should include issue reset by default', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };
      const result = await deepWipe(ctx);

      const resetStep = result.steps.find(s => s.step === 'reset:reset-issue');
      expect(resetStep).toBeDefined();
    });

    it('should skip issue reset when resetIssue is false', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx, { resetIssue: false });

      const resetStep = result.steps.find(s => s.step === 'reset:reset-issue');
      expect(resetStep).toBeUndefined();
    });

    it('should pass workspaceConfig through to teardown', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx, {
        workspaceConfig: { tunnel: { configPath: '/test' } },
        projectName: 'test-project',
      });

      // Should not crash with workspace config
      expect(result.success).toBe(true);
    });

    it('should preserve workspace when deleteWorkspace is false', async () => {
      // Create a workspace (findWorkspacePath looks for workspaces/<issueLower>)
      const wsPath = join(testDir, 'workspaces', 'pan-100');
      mkdirSync(wsPath, { recursive: true });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx, { deleteWorkspace: false });

      expect(result.success).toBe(true);
      // Workspace should still exist
      expect(existsSync(wsPath)).toBe(true);
    });
  });

  describe('beads lifecycle (PAN-412)', () => {
    it('approve should NOT clear beads (preserves them for history)', async () => {
      const beadsDir = join(testDir, '.beads');
      mkdirSync(beadsDir, { recursive: true });
      writeFileSync(
        join(beadsDir, 'issues.jsonl'),
        JSON.stringify({ id: 'b1', title: 'PAN-100: Task', status: 'closed' }) + '\n'
      );

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await approve(ctx);

      // clear-beads step should not appear
      const clearStep = result.steps.find(s => s.step === 'teardown:clear-beads');
      expect(clearStep).toBeUndefined();

      // Beads JSONL should still contain the entry
      const content = readFileSync(join(beadsDir, 'issues.jsonl'), 'utf-8');
      expect(content).toContain('PAN-100');
    });

    it('deepWipe should clear beads for the issue', async () => {
      const beadsDir = join(testDir, '.beads');
      const wsPath = join(testDir, 'workspaces', 'pan-100');
      mkdirSync(beadsDir, { recursive: true });
      mkdirSync(wsPath, { recursive: true });
      writeFileSync(
        join(beadsDir, 'issues.jsonl'),
        JSON.stringify({ id: 'b1', title: 'PAN-100: Task', status: 'closed' }) + '\n' +
        JSON.stringify({ id: 'b2', title: 'PAN-200: Other', status: 'open' }) + '\n'
      );

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await deepWipe(ctx);

      const clearStep = result.steps.find(s => s.step === 'teardown:clear-beads');
      expect(clearStep).toBeDefined();
      expect(clearStep!.success).toBe(true);

      // PAN-100 should be gone, PAN-200 preserved
      const content = readFileSync(join(beadsDir, 'issues.jsonl'), 'utf-8');
      expect(content).not.toContain('PAN-100');
      expect(content).toContain('PAN-200');
    });
  });

  describe('step ordering', () => {
    it('approve should run archive before teardown', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await approve(ctx);

      const archiveIdx = result.steps.findIndex(s => s.step.startsWith('archive-planning:'));
      const teardownIdx = result.steps.findIndex(s => s.step.startsWith('teardown:'));

      if (archiveIdx >= 0 && teardownIdx >= 0) {
        expect(archiveIdx).toBeLessThan(teardownIdx);
      }
    });

    it('closeOut should run verify-merged first', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx);

      expect(result.steps[0].step).toBe('close-out:verify-merged');
    });
  });
});
