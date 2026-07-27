import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getBuildInfo } from '../../../src/lib/deploy/build-info.js';
import {
  getDashboardIdentity,
  isLinkedWorktreeRoot,
  primaryRootFromLinkedWorktree,
  shouldRefuseHostDashboardPort,
} from '../../../src/dashboard/server/identity.js';

describe('dashboard build identity', () => {
  it('returns null build metadata when build-time globals are undefined', () => {
    expect(getBuildInfo()).toEqual({
      buildCommit: null,
      builtAt: null,
      buildDirty: null,
      buildBranch: null,
    });
  });

  it('includes build metadata without removing existing identity fields', () => {
    expect(getDashboardIdentity()).toMatchObject({
      repoRoot: process.cwd(),
      mode: expect.stringMatching(/^(primary|peer)$/),
      buildCommit: null,
      builtAt: null,
      buildDirty: null,
      buildBranch: null,
    });
  });
});

describe('linked git worktree identity', () => {
  it('detects a linked worktree and resolves its primary root', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pan-linked-worktree-'));
    try {
      writeFileSync(join(repoRoot, '.git'), 'gitdir: /primary/.git/worktrees/x\n');

      expect(isLinkedWorktreeRoot(repoRoot)).toBe(true);
      expect(primaryRootFromLinkedWorktree(repoRoot)).toBe('/primary');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects primary repositories and directories without git metadata', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'pan-primary-repo-'));
    try {
      const primaryRoot = join(fixtureRoot, 'primary');
      const noGitRoot = join(fixtureRoot, 'no-git');
      mkdirSync(join(primaryRoot, '.git'), { recursive: true });
      mkdirSync(noGitRoot);

      expect(isLinkedWorktreeRoot(primaryRoot)).toBe(false);
      expect(primaryRootFromLinkedWorktree(primaryRoot)).toBeNull();
      expect(isLinkedWorktreeRoot(noGitRoot)).toBe(false);
      expect(primaryRootFromLinkedWorktree(noGitRoot)).toBeNull();
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe('dashboard identity port guard', () => {
  it('refuses a peer dashboard on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'peer',
      port: 3011,
      hostDashboardApiPort: 3011,
      runningInContainer: false,
    })).toBe(true);
  });

  it('allows a peer dashboard on an explicit non-host port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'peer',
      port: 4011,
      hostDashboardApiPort: 3011,
      runningInContainer: false,
    })).toBe(false);
  });

  it('refuses a workspace checkout on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo/workspaces/feature-pan-2252',
      mode: 'primary',
      port: 3011,
      hostDashboardApiPort: 3011,
      runningInContainer: false,
    })).toBe(true);
  });

  it('allows the primary checkout on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'primary',
      port: 3011,
      hostDashboardApiPort: 3011,
      runningInContainer: false,
    })).toBe(false);
  });

  it('refuses a linked worktree on the host port except inside a container', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'hoff-linked-worktree-'));
    try {
      writeFileSync(join(repoRoot, '.git'), 'gitdir: /primary/.git/worktrees/hoff\n');
      const input = {
        repoRoot,
        mode: 'primary' as const,
        port: 3011,
        hostDashboardApiPort: 3011,
      };

      expect(shouldRefuseHostDashboardPort({
        ...input,
        runningInContainer: false,
      })).toBe(true);
      expect(shouldRefuseHostDashboardPort({
        ...input,
        runningInContainer: true,
      })).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('allows a peer dashboard on the host dashboard API port inside a container', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/repo',
      mode: 'peer',
      port: 3011,
      hostDashboardApiPort: 3011,
      runningInContainer: true,
    })).toBe(false);
  });

  it('allows the canonical workspace container repo root on the host dashboard API port', () => {
    expect(shouldRefuseHostDashboardPort({
      repoRoot: '/workspaces/overdeck',
      mode: 'peer',
      port: 3011,
      hostDashboardApiPort: 3011,
    })).toBe(false);
  });
});
