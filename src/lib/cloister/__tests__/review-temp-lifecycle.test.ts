import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());
const reviewStatusState = vi.hoisted(() => new Map<string, any>());
const dropStashMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: execMock };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((filePath: string) => String(filePath).endsWith('/tmp/template.md')),
  };
});

vi.mock('../../review-status.js', () => ({
  getReviewStatus: vi.fn((issueId: string) => reviewStatusState.get(issueId.toUpperCase())),
  setReviewStatus: vi.fn((issueId: string, update: Record<string, unknown>) => {
    const key = issueId.toUpperCase();
    const current = reviewStatusState.get(key) ?? {
      issueId: key,
      reviewStatus: 'pending',
      testStatus: 'pending',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    };
    const next = { ...current, ...update };
    Object.keys(next).forEach((k) => {
      if (next[k] === undefined) delete next[k];
    });
    reviewStatusState.set(key, next);
    return next;
  }),
}));

vi.mock('../../../lib/stashes.js', () => ({
  buildStashMessage: vi.fn((kind: string, issueId: string, arg: number) => `${kind}:${issueId.toUpperCase()}:${arg}`),
  createNamedStash: vi.fn(async () => 'abc123def456abc123def456abc123def456abcd'),
  dropStash: dropStashMock,
  getNextReviewTempSequence: vi.fn(() => 2),
  listStashes: vi.fn(async () => [{ ref: 'def456abc123def456abc123def456abc123def4', stackRef: 'stash@{1}', kind: 'review-temp', issueId: 'PAN-1', message: 'review-temp:PAN-1:1', sequence: 1 }]),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(async (filePath: string) => {
      if (String(filePath).endsWith('/tmp/template.md')) {
        return ['---', 'model: claude-sonnet-4-6', '---', 'review instructions'].join('\n');
      }
      if (String(filePath).includes('/synthesis.md')) return 'REVIEW_RESULT: APPROVED\nNOTES: ok';
      if (String(filePath).includes('/correctness.md')) return 'REVIEW_RESULT: APPROVED\nNOTES: ok';
      return '';
    }),
    writeFile: vi.fn(async () => {}),
    appendFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    unlink: vi.fn(async () => {}),
  };
});

vi.mock('../feedback-writer.js', () => ({
  archiveFeedbackFiles: vi.fn(async () => {}),
  writeFeedbackFile: vi.fn(async () => {}),
}));

vi.mock('../pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: vi.fn(), emitActivityTts: vi.fn() }));
vi.mock('../../projects.js', () => ({ resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon' })) }));
vi.mock('../specialists.js', () => ({
  getReviewerSessionName: vi.fn((role: string, projectKey: string, issueId: string) => `${projectKey}-${issueId}-${role}`),
}));
vi.mock('../../tmux.js', () => ({
  createSessionAsync: vi.fn(async () => {}),
  killSessionAsync: vi.fn(async () => {}),
  sessionExistsAsync: vi.fn(async () => false),
  sendKeysAsync: vi.fn(async () => {}),
  listSessionNamesAsync: vi.fn(async () => []),
  capturePaneAsync: vi.fn(async () => ''),
  setOptionAsync: vi.fn(async () => {}),
  isPaneDeadAsync: vi.fn(async () => false),
}));
vi.mock('../../agents.js', () => ({ getProviderExportsForModel: vi.fn(), getAgentRuntimeBaseCommand: vi.fn() }));
vi.mock('../../launcher-generator.js', () => ({ generateLauncherScript: vi.fn() }));
vi.mock('../../work-type-router.js', () => ({ getModelId: vi.fn(), hasOverride: vi.fn() }));
vi.mock('../../paths.js', () => ({
  AGENTS_DIR: '/tmp/agents',
  CACHE_AGENTS_DIR: '/tmp/cache-agents',
  CACHE_REVIEW_PROMPTS_DIR: '/tmp/cache-prompts',
  PANOPTICON_HOME: '/tmp/pan',
  packageRoot: '/tmp/pkg',
}));

import { dispatchParallelReview, runParallelReview } from '../review-agent.js';

describe('review-temp stash lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reviewStatusState.clear();
    dropStashMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates and persists a review-temp stash before spawning review coordinator', async () => {
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb)!;
      if (cmd === 'git status --porcelain') return callback(null, { stdout: ' M file.ts\n', stderr: '' });
      callback(new Error(`unexpected command: ${cmd}`));
    });

    const result = await dispatchParallelReview(
      { issueId: 'PAN-1', workspace: '/tmp/workspace', branch: 'feature/pan-1' },
      { coordinatorSpawnFn: async () => ({ sessionName: 'review-coordinator-PAN-1-1' }) },
    );

    expect(result.success).toBe(true);
    expect(reviewStatusState.get('PAN-1')).toMatchObject({
      reviewTempStashRef: 'abc123def456abc123def456abc123def456abcd',
      reviewTempStashMessage: 'review-temp:PAN-1:2',
      reviewTempStashSequence: 2,
    });
  });

  it('clears persisted review-temp stash metadata when coordinator spawn fails', async () => {
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb)!;
      if (cmd === 'git status --porcelain') return callback(null, { stdout: ' M file.ts\n', stderr: '' });
      callback(new Error(`unexpected command: ${cmd}`));
    });
    dropStashMock.mockRejectedValueOnce(new Error('stash cleanup failed'));

    const result = await dispatchParallelReview(
      { issueId: 'PAN-9', workspace: '/tmp/workspace', branch: 'feature/pan-9' },
      { coordinatorSpawnFn: async () => { throw new Error('tmux unavailable'); } },
    );

    expect(result.success).toBe(false);
    expect(reviewStatusState.get('PAN-9')).toMatchObject({
      reviewStatus: 'failed',
      reviewNotes: 'Coordinator spawn failed: tmux unavailable',
    });
    expect(reviewStatusState.get('PAN-9')?.reviewTempStashRef).toBeUndefined();
    expect(reviewStatusState.get('PAN-9')?.reviewTempStashMessage).toBeUndefined();
    expect(reviewStatusState.get('PAN-9')?.reviewTempStashSequence).toBeUndefined();
  });

  it('drops persisted review-temp stash in runParallelReview finally block', async () => {
    reviewStatusState.set('PAN-2', {
      issueId: 'PAN-2',
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
      reviewTempStashRef: 'abc123def456abc123def456abc123def456abcd',
      reviewTempStashMessage: 'review-temp:PAN-2:3',
      reviewTempStashSequence: 3,
    });

    const waitFn = vi.fn(async () => 'failed' as const);

    const { result } = await runParallelReview(
      {
        issueId: 'PAN-2',
        projectPath: '/tmp/workspace',
        prUrl: 'https://example.test/pr/2',
        branch: 'feature/pan-2',
      },
      ['src/file.ts'],
      [{ name: 'correctness' } as any],
      {
        spawnFn: vi.fn(async () => {}),
        waitFn,
        waitSynthesisFn: vi.fn(async () => 'completed' as const),
        parseSynthesisFn: vi.fn(async () => ({ success: true, reviewResult: 'APPROVED' as const })),
        postReviewFn: vi.fn(async () => {}),
        resolvePromptTemplateFn: vi.fn(() => '/tmp/template.md'),
      },
    );

    expect(result.success).toBe(false);
    expect(reviewStatusState.get('PAN-2')?.reviewTempStashRef).toBeUndefined();
  });
});
