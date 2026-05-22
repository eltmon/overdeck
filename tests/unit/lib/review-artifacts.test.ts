import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { execMock, ensureMergeSetForIssueMock, upsertMergeSetMock, createReviewArtifactMock } = vi.hoisted(() => ({
  execMock: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  ensureMergeSetForIssueMock: vi.fn(),
  upsertMergeSetMock: vi.fn(),
  createReviewArtifactMock: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    execMock(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((err: any) => callback(err, err.stdout || '', err.stderr || ''));
  }

  (exec as any)[kCustom] = execMock;
  return { ...actual, exec };
});

vi.mock('../../../src/lib/merge-set.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/merge-set.js')>();
  return {
    ...actual,
    ensureMergeSetForIssue: ensureMergeSetForIssueMock,
    upsertMergeSet: upsertMergeSetMock,
  };
});

vi.mock('../../../src/lib/forge.js', () => ({
  getForgeAdapter: vi.fn(() => ({
    createReviewArtifact: createReviewArtifactMock,
  })),
}));

import { createReviewArtifactsForIssue } from '../../../src/lib/review-artifacts.js';

describe('review-artifacts', () => {
  let workspacePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-review-artifacts-'));

    mkdirSync(join(workspacePath, '.git'));
    mkdirSync(join(workspacePath, 'fe', '.git'), { recursive: true });
    mkdirSync(join(workspacePath, 'api', '.git'), { recursive: true });

    ensureMergeSetForIssueMock.mockReturnValue({
      issueId: 'MIN-632',
      projectKey: 'mind-your-now',
      projectPath: '/tmp/myn',
      workspaceType: 'polyrepo',
      status: 'draft',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
      repos: [
        {
          repoKey: 'fe',
          repoPath: '/tmp/myn/frontend',
          forge: 'gitlab',
          sourceBranch: 'feature/min-632',
          targetBranch: 'main',
          reviewStatus: 'pending',
          testStatus: 'pending',
          rebaseStatus: 'pending',
          verificationStatus: 'pending',
          mergeStatus: 'pending',
          mergeOrder: 0,
          required: true,
        },
        {
          repoKey: 'api',
          repoPath: '/tmp/myn/api',
          forge: 'github',
          sourceBranch: 'feature/min-632',
          targetBranch: 'main',
          reviewStatus: 'pending',
          testStatus: 'pending',
          rebaseStatus: 'pending',
          verificationStatus: 'pending',
          mergeStatus: 'pending',
          mergeOrder: 1,
          required: true,
        },
      ],
    });
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('creates artifacts only for repos with changes and skips untouched repos', async () => {
    execMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(Object.assign(new Error('diff'), { code: 1 }))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    createReviewArtifactMock.mockResolvedValue({
      forge: 'gitlab',
      created: true,
      url: 'https://gitlab.example.com/merge_requests/7',
      id: '7',
    });

    const result = await Effect.runPromise(createReviewArtifactsForIssue('MIN-632', workspacePath));

    expect(result.artifacts).toEqual([
      {
        repoKey: 'fe',
        created: true,
        skipped: false,
        url: 'https://gitlab.example.com/merge_requests/7',
        id: '7',
      },
      {
        repoKey: 'api',
        created: false,
        skipped: true,
      },
    ]);
    expect(createReviewArtifactMock).toHaveBeenCalledOnce();
    expect(upsertMergeSetMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'reviewing',
      repos: expect.arrayContaining([
        expect.objectContaining({ repoKey: 'fe', artifactUrl: 'https://gitlab.example.com/merge_requests/7', artifactId: '7' }),
        expect.objectContaining({ repoKey: 'api', mergeStatus: 'skipped', reviewStatus: 'skipped' }),
      ]),
    }));
  });
});
