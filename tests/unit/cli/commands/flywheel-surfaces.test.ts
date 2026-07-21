import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());
const githubAppMocks = vi.hoisted(() => ({
  isGitHubAppConfigured: vi.fn(() => false),
  listIssuesWithAnyLabelPromise: vi.fn(async () => []),
  listOpenIssuesWithLabels: vi.fn(() => Effect.succeed([])),
  listOpenIssuesWithLabelsPromise: vi.fn(async () => []),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  function exec(command: string, optionsOrCallback?: unknown, maybeCallback?: unknown) {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    execMock(command, typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined)
      .then(({ stdout, stderr }: { stdout: string; stderr: string }) => callback(null, stdout, stderr))
      .catch((error: Error) => callback(error, '', error.message));
  }
  function execFile(file: string, args: string[], optionsOrCallback?: unknown, maybeCallback?: unknown) {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    execFileMock(file, args, typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined)
      .then(({ stdout, stderr }: { stdout: string; stderr: string }) => callback(null, stdout, stderr))
      .catch((error: Error) => callback(error, '', error.message));
  }

  (exec as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = execMock;
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = execFileMock;
  return { ...actual, exec, execFile };
});

vi.mock('../../../../src/lib/github-app.js', () => ({
  isGitHubAppConfigured: githubAppMocks.isGitHubAppConfigured,
  listIssuesWithAnyLabelPromise: githubAppMocks.listIssuesWithAnyLabelPromise,
  listOpenIssuesWithLabels: githubAppMocks.listOpenIssuesWithLabels,
  listOpenIssuesWithLabelsPromise: githubAppMocks.listOpenIssuesWithLabelsPromise,
}));

import { fetchOpenIssueLabels } from '../../../../src/cli/commands/flywheel-surfaces.js';

describe('fetchOpenIssueLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    githubAppMocks.isGitHubAppConfigured.mockReturnValue(false);
    githubAppMocks.listOpenIssuesWithLabels.mockReturnValue(Effect.succeed([]));
    execMock.mockImplementation(async (command: string) => {
      if (command === 'git remote get-url origin') {
        return { stdout: 'git@github.com:eltmon/overdeck.git\n', stderr: '' };
      }
      return { stdout: '[]', stderr: '' };
    });
    execFileMock.mockResolvedValue({ stdout: '[]', stderr: '' });
  });

  it('uses App REST labels when the GitHub App is configured', async () => {
    githubAppMocks.isGitHubAppConfigured.mockReturnValue(true);
    githubAppMocks.listOpenIssuesWithLabels.mockReturnValue(Effect.succeed([
      { number: 2265, labels: ['pan-2265', 'backend'] },
    ]));

    const labels = await fetchOpenIssueLabels();

    expect(labels.get('2265')).toEqual(['pan-2265', 'backend']);
    expect(githubAppMocks.listOpenIssuesWithLabels).toHaveBeenCalledWith('eltmon', 'overdeck');
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalledWith(expect.stringContaining('gh issue list'), expect.anything());
  });

  it('falls back to gh api REST pagination and filters pull requests', async () => {
    execMock.mockImplementation(async (command: string) => {
      if (command === 'git remote get-url origin') {
        return { stdout: 'https://github.com/eltmon/overdeck.git\n', stderr: '' };
      }
      throw new Error(`unexpected exec command: ${command}`);
    });
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify([[
        { number: 1, labels: [{ name: 'ready' }, { name: 'backend' }] },
        { number: 2, pull_request: { url: 'https://api.github.com/repos/eltmon/overdeck/pulls/2' }, labels: [{ name: 'pr' }] },
      ]]),
      stderr: '',
    });

    const labels = await fetchOpenIssueLabels();

    expect(labels.get('1')).toEqual(['ready', 'backend']);
    expect(labels.has('2')).toBe(false);
    expect(githubAppMocks.listOpenIssuesWithLabels).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      'gh',
      ['api', '--paginate', '--slurp', 'repos/eltmon/overdeck/issues?state=open&per_page=100'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('degrades to an empty map when repository resolution fails', async () => {
    execMock.mockRejectedValue(new Error('not a git repo'));

    await expect(fetchOpenIssueLabels()).resolves.toEqual(new Map());
  });
});
