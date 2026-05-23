import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Use vi.hoisted to avoid initialization order issues
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

import { Effect } from 'effect';
import {
  movePrd as movePrdProgram,
  findWorkspacePath,
  archiveWorkspaceArtifacts as archiveWorkspaceArtifactsProgram,
} from '../../../../src/lib/lifecycle/archive-planning.js';

const movePrd = (...args: Parameters<typeof movePrdProgram>) => Effect.runPromise(movePrdProgram(...args));
const archiveWorkspaceArtifacts = (...args: Parameters<typeof archiveWorkspaceArtifactsProgram>) =>
  Effect.runPromise(archiveWorkspaceArtifactsProgram(...args));

describe('archive-planning', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `panopticon-archive-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe('findWorkspacePath', () => {
    it('should find workspace in workspaces/ directory', () => {
      // findWorkspacePath looks for workspaces/<issueLower>, NOT workspaces/feature-<issueLower>
      const wsPath = join(testDir, 'workspaces', 'pan-100');
      mkdirSync(wsPath, { recursive: true });

      const result = findWorkspacePath(testDir, 'pan-100');
      expect(result).toBe(wsPath);
    });

    it('should return null when no workspace exists', () => {
      const result = findWorkspacePath(testDir, 'pan-999');
      expect(result).toBeNull();
    });

    it('should find workspace in .worktrees/ directory', () => {
      const wsPath = join(testDir, '.worktrees', 'pan-100');
      mkdirSync(wsPath, { recursive: true });

      const result = findWorkspacePath(testDir, 'pan-100');
      expect(result).toBe(wsPath);
    });
  });

  describe('movePrd', () => {
    it('should skip when no active PRD exists', async () => {
      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await movePrd(ctx);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('should move PRD from active to completed via copy fallback', async () => {
      // Create active PRD
      const activeDir = join(testDir, 'docs', 'prds', 'active');
      const completedDir = join(testDir, 'docs', 'prds', 'completed');
      mkdirSync(activeDir, { recursive: true });
      mkdirSync(completedDir, { recursive: true });
      writeFileSync(join(activeDir, 'pan-100-plan.md'), '# PAN-100 Plan');

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await movePrd(ctx);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
    });

    it('should skip when PRD already exists in completed', async () => {
      // Only completed PRD exists (already moved)
      const completedDir = join(testDir, 'docs', 'prds', 'completed');
      mkdirSync(completedDir, { recursive: true });
      writeFileSync(join(completedDir, 'pan-100-plan.md'), '# PAN-100 Plan');

      const ctx = { issueId: 'PAN-100', projectPath: testDir };
      const result = await movePrd(ctx);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });
  });
});
