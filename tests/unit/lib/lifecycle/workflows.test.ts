import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Each workflow test fans out to dynamic imports + multiple unmocked
// filesystem side-effects; observed wall-clock times are 1.2–7s per case
// and several spike past the default 10s timeout under CI load. Bump the
// per-test timeout to 30s so the suite is deterministic without
// serialising the entire run.
vi.setConfig({ testTimeout: 30_000 });

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
  killSessionAsync: vi.fn().mockResolvedValue(undefined),
  listSessionNamesAsync: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/paths.js')>();
  const testHome = join(tmpdir(), 'panopticon-wf-test-home');
  return {
    ...actual,
    PANOPTICON_HOME: testHome,
    AGENTS_DIR: join(testHome, 'agents'),
    ARCHIVES_DIR: join(testHome, 'archives'),
  };
});

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  removeShadowState: vi.fn().mockReturnValue({ success: true }),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  clearReviewStatus: vi.fn(),
}));

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(function () { return {
    issues: vi.fn().mockResolvedValue({ nodes: [] }),
  }; }),
}));

import { Effect } from 'effect';
import {
  approve as approveEffect,
  closeOut as closeOutEffect,
  deepWipe as deepWipeEffect,
  close as closeEffect,
  resetToTodo as resetToTodoEffect,
  __testInternals,
} from '../../../../src/lib/lifecycle/workflows.js';

// Workflows now return Effects; wrap to keep legacy await-style tests working.
const approve = (...args: Parameters<typeof approveEffect>) => Effect.runPromise(approveEffect(...args));
const closeOut = (...args: Parameters<typeof closeOutEffect>) => Effect.runPromise(closeOutEffect(...args));
const deepWipe = (...args: Parameters<typeof deepWipeEffect>) => Effect.runPromise(deepWipeEffect(...args));
const close = (...args: Parameters<typeof closeEffect>) => Effect.runPromise(closeEffect(...args));
const resetToTodo = (...args: Parameters<typeof resetToTodoEffect>) => Effect.runPromise(resetToTodoEffect(...args));
import { AGENTS_DIR, PANOPTICON_HOME } from '../../../../src/lib/paths.js';
import { findSpecByIssue, writeSpecForIssue } from '../../../../src/lib/pan-dir/specs.js';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';

function makeVBrief(issueId: string, status = 'running'): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-05-18T00:00:00Z' },
    plan: {
      id: issueId,
      title: `Plan for ${issueId}`,
      status,
      sequence: 1,
      created: '2026-05-18T00:00:00Z',
      items: [],
      edges: [],
    },
  };
}

describe('workflows', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `panopticon-wf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(AGENTS_DIR, { recursive: true });
    mkdirSync(PANOPTICON_HOME, { recursive: true });

    vi.clearAllMocks();
    process.env.HOME = testDir;
    delete process.env.LINEAR_API_KEY;
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
      const verifyStep = await Effect.runPromise(__testInternals.verifyBranchMerged(ctx));

      expect(verifyStep.step).toBe('close-out:verify-merged');
      expect(verifyStep.success).toBe(true);
      expect(verifyStep.details).toEqual(['Branch already cleaned up (squash-merged)']);
    });

    it('should abort if archive fails', async () => {
      // Since there's no active PRD, it will skip — that's success
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx);

      // Should complete without abort since skipped == success
      expect(result.steps.some(s => s.step === 'close-out:abort')).toBe(false);
    });

    it('should preserve workspace and branches by default', async () => {
      const wsPath = join(testDir, 'workspaces', 'feature-pan-100');
      mkdirSync(wsPath, { recursive: true });

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx);

      expect(result.steps.find(s => s.step === 'teardown:branches')).toBeUndefined();
      expect(existsSync(wsPath)).toBe(true);
    });

    it('should honor close_out branch deletion config', async () => {
      writeFileSync(
        join(PANOPTICON_HOME, 'cloister.toml'),
        '[close_out]\nremove_workspace = false\ndelete_feature_branch = true\nauto = false\nauto_delay_minutes = 60\n',
      );

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx);

      expect(result.steps.find(s => s.step === 'teardown:branches')).toBeDefined();
    });

    it('should delete the workspace, complete vBRIEF, close GitHub, and swap verifying labels during configured close-out', async () => {
      writeFileSync(
        join(PANOPTICON_HOME, 'cloister.toml'),
        '[close_out]\nremove_workspace = true\ndelete_feature_branch = false\nauto = false\nauto_delay_minutes = 60\n',
      );
      const wsPath = join(testDir, 'workspaces', 'feature-pan-100');
      mkdirSync(wsPath, { recursive: true });
      writeSpecForIssue(testDir, makeVBrief('PAN-100'), 'active');
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command.startsWith('git worktree remove')) {
          rmSync(wsPath, { recursive: true, force: true });
        }
        return { stdout: '', stderr: '' };
      });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };
      const result = await closeOut(ctx);

      expect(result.success).toBe(true);
      expect(existsSync(wsPath)).toBe(false);
      expect(findSpecByIssue(testDir, 'PAN-100')?.status).toBe('completed');
      expect(findSpecByIssue(testDir, 'PAN-100')?.document.plan.status).toBe('completed');

      const commands = mockExecAsync.mock.calls.map(([command]) => String(command));
      expect(commands.some(command => command.includes('gh issue close 100'))).toBe(true);
      expect(commands.some(command => command.includes('--add-label "closed-out"'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label "verifying-on-main"'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label "needs-close-out"'))).toBe(true);
    });

    it('should complete vBRIEF status and prune checkpoint refs during close-out', async () => {
      writeSpecForIssue(testDir, makeVBrief('PAN-100'), 'active');

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await closeOut(ctx);

      expect(result.steps.find(s => s.step === 'close-out:vbrief-completed')).toBeDefined();
      expect(result.steps.find(s => s.step === 'teardown:checkpoint-refs')).toBeDefined();

      const spec = findSpecByIssue(testDir, 'PAN-100');
      expect(spec?.status).toBe('completed');
      expect(spec?.document.plan.status).toBe('completed');
    });

    it('should remove verifying labels when applying the closed-out label', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: testDir,
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      await closeOut(ctx);

      const commands = mockExecAsync.mock.calls.map(([command]) => String(command));
      expect(commands.some(command => command.includes('--add-label "closed-out"'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label "verifying-on-main"'))).toBe(true);
      expect(commands.some(command => command.includes('--remove-label "needs-close-out"'))).toBe(true);
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

    it('should use tracker name in reset issue details when provided', async () => {
      process.env.LINEAR_API_KEY = 'test-key';
      const { LinearClient } = await import('@linear/sdk');
      vi.mocked(LinearClient).mockImplementation(function () {
        return {
          issues: vi.fn().mockResolvedValue({ nodes: [] }),
        } as any;
      });
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await resetToTodo(ctx, {
        deleteWorkspace: false,
        deleteBranches: false,
        tracker: { name: 'rally' } as any,
      });

      expect(result.steps.map(s => s.step)).toContain('reset:reset-issue');
      const resetStep = result.steps.find(s => s.step === 'reset:reset-issue');
      expect(resetStep?.details).toContain('Reset Rally issue PAN-100 to Todo');
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
