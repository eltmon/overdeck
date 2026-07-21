import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MergeSet } from '../../../src/lib/merge-set.js';

const { execAsyncMock } = vi.hoisted(() => ({
  execAsyncMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const exec = vi.fn();
  (exec as any)[Symbol.for('nodejs.util.promisify.custom')] = execAsyncMock;
  return { ...actual, exec };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

import { rebaseAndPushRepos } from '../../../src/lib/rebase-helper.js';

const mergeSet: MergeSet = {
  issueId: 'PAN-806',
  projectKey: 'overdeck',
  projectPath: '/project',
  workspaceType: 'monorepo',
  status: 'draft',
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  repos: [{
    repoKey: 'overdeck',
    repoPath: '/project',
    forge: 'github',
    sourceBranch: 'feature/pan-806',
    targetBranch: 'main',
    reviewStatus: 'pending',
    testStatus: 'pending',
    rebaseStatus: 'pending',
    verificationStatus: 'pending',
    mergeStatus: 'pending',
    mergeOrder: 0,
    required: true,
  }],
};

function resolved(stdout = ''): Promise<{ stdout: string; stderr: string }> {
  return Promise.resolve({ stdout, stderr: '' });
}

function optionsFor(command: string): Record<string, any> {
  const call = execAsyncMock.mock.calls.find(([calledCommand]) => calledCommand === command);
  expect(call, `expected execAsync call for ${command}`).toBeDefined();
  return call![1];
}

describe('rebaseAndPushRepos', () => {
  beforeEach(() => {
    execAsyncMock.mockReset();
  });

  it('sets the pan git-op sentinel alongside GIT_EDITOR for rebase', async () => {
    execAsyncMock.mockImplementation((command: string) => {
      if (command === 'git merge-base HEAD origin/main') return resolved('old-base\n');
      if (command === 'git rev-parse origin/main') return resolved('target-head\n');
      return resolved();
    });

    const result = await Effect.runPromise(rebaseAndPushRepos('/workspace', mergeSet));

    expect(result.success).toBe(true);
    expect(optionsFor('git rebase origin/main').env).toEqual(expect.objectContaining({
      GIT_EDITOR: 'true',
      OVERDECK_PAN_GIT_OP: '1',
    }));
  });

  it('sets the pan git-op sentinel alongside GIT_EDITOR for rebase --continue', async () => {
    execAsyncMock.mockImplementation((command: string) => {
      if (command === 'git merge-base HEAD origin/main') return resolved('old-base\n');
      if (command === 'git rev-parse origin/main') return resolved('target-head\n');
      if (command === 'git rebase origin/main') return Promise.reject(new Error('conflict'));
      if (command === 'git status --porcelain') return resolved('UU .pan/continue.json\n');
      return resolved();
    });

    const result = await Effect.runPromise(rebaseAndPushRepos('/workspace', mergeSet));

    expect(result.success).toBe(true);
    expect(optionsFor('git rebase --continue').env).toEqual(expect.objectContaining({
      GIT_EDITOR: 'true',
      OVERDECK_PAN_GIT_OP: '1',
    }));
  });

  it('sets the pan git-op sentinel for rebase abort and merge fallback', async () => {
    execAsyncMock.mockImplementation((command: string) => {
      if (command === 'git merge-base HEAD origin/main') return resolved('old-base\n');
      if (command === 'git rev-parse origin/main') return resolved('target-head\n');
      if (command === 'git rebase origin/main') return Promise.reject(new Error('conflict'));
      if (command === 'git status --porcelain') return resolved('UU src/index.ts\n');
      return resolved();
    });

    const result = await Effect.runPromise(rebaseAndPushRepos('/workspace', mergeSet));

    expect(result.success).toBe(true);
    expect(optionsFor('git rebase --abort').env).toEqual(expect.objectContaining({
      OVERDECK_PAN_GIT_OP: '1',
    }));
    expect(optionsFor('git merge origin/main').env).toEqual(expect.objectContaining({
      OVERDECK_PAN_GIT_OP: '1',
    }));
  });
});
