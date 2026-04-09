import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the worktree module
vi.mock('../../src/lib/worktree.js', () => ({
  createWorktree: vi.fn().mockResolvedValue({ success: true, message: 'Worktree created' }),
  removeWorktree: vi.fn().mockResolvedValue({ success: true, message: 'Worktree removed' }),
}));

describe('workspace-manager', () => {
  describe('addReposToWorkspace', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'pan-workspace-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true });
    });

    it('should return error when project is not polyrepo', async () => {
      const { addReposToWorkspace } = await import('../../src/lib/workspace-manager.js');

      const result = await addReposToWorkspace({
        projectConfig: {
          name: 'test-project',
          path: tempDir,
          workspace: {
            type: 'monorepo',
          },
        },
        featureName: 'test-issue',
        repoNames: ['repo1'],
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Project does not use polyrepo workspace configuration');
    });

    it('should return error when workspace does not exist', async () => {
      const { addReposToWorkspace } = await import('../../src/lib/workspace-manager.js');

      const result = await addReposToWorkspace({
        projectConfig: {
          name: 'test-project',
          path: tempDir,
          workspace: {
            type: 'polyrepo',
            repos: [{ name: 'repo1', path: 'repos/repo1' }],
          },
        },
        featureName: 'nonexistent',
        repoNames: ['repo1'],
      });

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Workspace not found');
    });

    it('should return error for unknown repos', async () => {
      const { addReposToWorkspace } = await import('../../src/lib/workspace-manager.js');

      // Create workspace directory
      mkdirSync(join(tempDir, 'workspaces', 'feature-test-issue'), { recursive: true });

      const result = await addReposToWorkspace({
        projectConfig: {
          name: 'test-project',
          path: tempDir,
          workspace: {
            type: 'polyrepo',
            repos: [{ name: 'repo1', path: 'repos/repo1' }],
            workspaces_dir: 'workspaces',
          },
        },
        featureName: 'test-issue',
        repoNames: ['unknown-repo'],
      });

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Unknown repos');
    });

    it('should skip repos already in workspace', async () => {
      const { addReposToWorkspace } = await import('../../src/lib/workspace-manager.js');

      // Create workspace directory with existing repo
      const workspacePath = join(tempDir, 'workspaces', 'feature-test-issue');
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(join(workspacePath, 'repo1'), { recursive: true }); // repo1 already exists

      const result = await addReposToWorkspace({
        projectConfig: {
          name: 'test-project',
          path: tempDir,
          workspace: {
            type: 'polyrepo',
            repos: [{ name: 'repo1', path: 'repos/repo1' }],
            workspaces_dir: 'workspaces',
          },
        },
        featureName: 'test-issue',
        repoNames: ['repo1'],
      });

      expect(result.success).toBe(true);
      expect(result.steps).toContain('Skipped repo1: already exists in workspace');
    });

    it('should create symlink for symlink-type repos', async () => {
      const { addReposToWorkspace } = await import('../../src/lib/workspace-manager.js');

      // Create workspace and source repo directories
      const workspacePath = join(tempDir, 'workspaces', 'feature-test-issue');
      mkdirSync(workspacePath, { recursive: true });
      const sourceRepoPath = join(tempDir, 'repos', 'meta');
      mkdirSync(sourceRepoPath, { recursive: true });

      const result = await addReposToWorkspace({
        projectConfig: {
          name: 'test-project',
          path: tempDir,
          workspace: {
            type: 'polyrepo',
            repos: [{ name: 'meta', path: 'repos/meta', link_type: 'symlink' }],
            workspaces_dir: 'workspaces',
          },
        },
        featureName: 'test-issue',
        repoNames: ['meta'],
      });

      expect(result.success).toBe(true);
      expect(result.steps).toContain('Added symlink for meta (readonly)');
      expect(existsSync(join(workspacePath, 'meta'))).toBe(true);
    });

    it('should dry-run without making changes', async () => {
      const { addReposToWorkspace } = await import('../../src/lib/workspace-manager.js');

      // Create workspace directory
      const workspacePath = join(tempDir, 'workspaces', 'feature-test-issue');
      mkdirSync(workspacePath, { recursive: true });

      const result = await addReposToWorkspace({
        projectConfig: {
          name: 'test-project',
          path: tempDir,
          workspace: {
            type: 'polyrepo',
            repos: [{ name: 'repo1', path: 'repos/repo1' }],
            workspaces_dir: 'workspaces',
          },
        },
        featureName: 'test-issue',
        repoNames: ['repo1'],
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.steps[0]).toContain('[DRY RUN]');
    });
  });
});
