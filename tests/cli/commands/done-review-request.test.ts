/**
 * PAN-3917 (W12): `pan done`'s last step asks the dashboard to start
 * verification and the review convoy — the same request `pan review request`
 * makes. Before this, `pan done` opened the PR, moved the tracker to In Review
 * and stopped: nothing started the review, and the issue sat in review with no
 * reviewer. A dashboard that cannot be reached is a hint, not a failure — the
 * PR and the tracker are already updated, so the agent must not re-run done.
 */
import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  requestReviewMock,
  resolveProjectMock,
  findWorkspacePathMock,
  mergeSetMock,
  forgeAdapterMock,
  execFileMock,
  emitActivityMock,
  emitTtsMock,
  exitCliMock,
} = vi.hoisted(() => ({
  requestReviewMock: vi.fn(),
  resolveProjectMock: vi.fn(),
  findWorkspacePathMock: vi.fn(),
  mergeSetMock: vi.fn(),
  forgeAdapterMock: vi.fn(),
  execFileMock: vi.fn(),
  emitActivityMock: vi.fn(),
  emitTtsMock: vi.fn(),
  exitCliMock: vi.fn(),
}));

vi.mock('../../../src/cli/commands/request-review.js', () => ({
  requestReviewViaDashboard: requestReviewMock,
}));
vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: resolveProjectMock,
}));
vi.mock('../../../src/lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: findWorkspacePathMock,
}));
vi.mock('../../../src/lib/merge-set.js', () => ({
  buildMergeSetForIssue: mergeSetMock,
}));
vi.mock('../../../src/lib/project-repos.js', () => ({
  resolveProjectReposForIssue: () => [{ repoKey: 'main', forge: 'github' }],
  computeWorkspaceRepoRoots: () => [{
    repoKey: 'main',
    dir: '/project/workspaces/feature-min-1',
    sourceBranch: 'feature/min-1',
    targetBranch: 'main',
  }],
}));
vi.mock('../../../src/lib/forge.js', () => ({
  getForgeAdapter: forgeAdapterMock,
}));
vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: emitActivityMock,
  emitActivityTts: emitTtsMock,
}));
vi.mock('../../../src/lib/shadow-utils.js', () => ({
  getLinearApiKey: () => Effect.succeed(null),
}));
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: exitCliMock,
}));
vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync: () => true,
}));
vi.mock('ora', () => ({
  default: () => {
    const spinner = {
      text: '',
      start: () => spinner,
      succeed: () => spinner,
      fail: () => spinner,
    };
    return spinner;
  },
}));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execFile = execFileMock;
  Object.assign(execFile, {
    // `repoHasChanges` reads `git diff --quiet origin/main...HEAD`: a non-zero
    // exit (a rejection) means the branch has commits the target does not.
    [Symbol.for('nodejs.util.promisify.custom')]: (file: string, args: string[]) => (
      file === 'git' && args?.includes('diff')
        ? Promise.reject(new Error('has changes'))
        : Promise.resolve({ stdout: '', stderr: '' })
    ),
  });
  return { ...actual, execFile };
});

import { doneCommand, startReviewPipeline } from '../../../src/cli/commands/done.js';

describe('pan done → review request (PAN-3917 W12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    resolveProjectMock.mockReturnValue({ projectKey: 'min', projectPath: '/project' });
    findWorkspacePathMock.mockReturnValue('/project/workspaces/feature-min-1');
    mergeSetMock.mockReturnValue(null);
    forgeAdapterMock.mockReturnValue({
      forge: 'gitlab',
      createReviewArtifact: async () => ({
        url: 'https://example.com/mr/1',
        id: '1',
        created: true,
      }),
    });
    requestReviewMock.mockResolvedValue({
      kind: 'ok',
      status: 202,
      result: { message: 'Verification started for MIN-1; review will start automatically when it passes' },
    });
  });

  it('asks the dashboard to start the review after the PR and the tracker', async () => {
    await doneCommand('MIN-1', { force: true });

    expect(requestReviewMock).toHaveBeenCalledTimes(1);
    expect(requestReviewMock.mock.calls[0]![0]).toBe('MIN-1');
    expect(exitCliMock).not.toHaveBeenCalled();
  });

  it('an unreachable dashboard prints the hint and still exits 0', async () => {
    requestReviewMock.mockResolvedValue({ kind: 'unreachable', error: 'ECONNREFUSED' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await doneCommand('MIN-1', { force: true });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    logSpy.mockRestore();

    expect(output).toContain('Review not started (dashboard unreachable): run pan review request MIN-1');
    expect(exitCliMock).not.toHaveBeenCalled();
  });
});

describe('startReviewPipeline (PAN-3917 W12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the dashboard message on success', async () => {
    requestReviewMock.mockResolvedValue({
      kind: 'ok', status: 202, result: { message: 'Verification started for PAN-3705' },
    });

    const result = await startReviewPipeline('PAN-3705');

    expect(result.started).toBe(true);
    expect(result.line).toContain('Verification started for PAN-3705');
  });

  it('a refusal names the reason and the manual command, without failing done', async () => {
    requestReviewMock.mockResolvedValue({
      kind: 'rejected', status: 400, result: { error: 'Workspace has uncommitted changes' },
    });

    const result = await startReviewPipeline('PAN-3705');

    expect(result.started).toBe(false);
    expect(result.line).toContain('Workspace has uncommitted changes');
    expect(result.line).toContain('pan review request PAN-3705');
  });

  it('an unreachable dashboard is a hint, not an error', async () => {
    requestReviewMock.mockResolvedValue({ kind: 'unreachable', error: 'ECONNREFUSED' });

    const result = await startReviewPipeline('PAN-3705');

    expect(result.started).toBe(false);
    expect(result.line).toContain('dashboard unreachable');
    expect(result.line).toContain('pan review request PAN-3705');
  });
});
