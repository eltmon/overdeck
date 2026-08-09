import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());
const buildClassifyLookupsMock = vi.hoisted(() => vi.fn((_: string, opts: { labels?: (id: string) => readonly string[] }) => ({
  labels: opts.labels ?? (() => []),
  isPlanned: (id: string) => id === 'PAN-3',
  isInPipeline: () => false,
})));

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

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: string) => path.endsWith('/.pan/backlog/sequence.md'),
    readFileSync: () => 'fixture',
  };
});

vi.mock('../../../../src/lib/backlog/sequence-io.js', () => ({
  parseSequenceMd: () => ({
    ok: true,
    doc: {
      nodes: [
        { issue: 'PAN-1', rank: 1, size: 'S', gate: 'auto' },
        { issue: 'PAN-2', rank: 2, size: 'S', gate: 'auto' },
        { issue: 'PAN-3', rank: 3, size: 'S', gate: 'auto' },
        { issue: 'PAN-4', rank: 4, size: 'S', gate: 'auto' },
      ],
    },
  }),
}));

vi.mock('../../../../src/lib/backlog/lookups.js', () => ({
  buildClassifyLookups: buildClassifyLookupsMock,
}));

vi.mock('../../../../src/lib/cloister/flywheel.js', () => ({
  activeOrderBookIssues: async () => new Set<string>(),
}));

vi.mock('../../../../src/lib/overdeck/control-settings.js', () => ({
  isFlywheelAutoPickupBacklog: () => false,
}));

import { backlogForecastCommand, fetchOpenIssueLabels } from '../../../../src/cli/commands/flywheel-surfaces.js';

describe('backlog forecast labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execMock.mockImplementation(async (command: string) => {
      if (command === 'git remote get-url origin') {
        return { stdout: 'git@github.com:eltmon/overdeck.git\n', stderr: '' };
      }
      throw new Error(`unexpected exec command: ${command}`);
    });
    execFileMock.mockResolvedValue({ stdout: '[]', stderr: '' });
  });

  it('fetches labels through the authenticated gh REST client and filters pull requests', async () => {
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
    expect(execFileMock).toHaveBeenCalledWith(
      'gh',
      ['api', '--paginate', '--slurp', 'repos/eltmon/overdeck/issues?state=open&per_page=100'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('fails when label retrieval fails instead of returning an empty classification', async () => {
    execFileMock.mockRejectedValue(new Error('gh unavailable'));

    await expect(fetchOpenIssueLabels()).rejects.toThrow('gh unavailable');
  });

  it('fails when origin cannot identify the GitHub repository', async () => {
    execMock.mockResolvedValue({ stdout: 'https://example.test/not-github.git\n', stderr: '' });

    await expect(fetchOpenIssueLabels()).rejects.toThrow('origin is not a GitHub repository');
  });

  it('preserves label-derived counters for a CLI-shaped forecast', async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify([[
        { number: 1, labels: [{ name: 'blocks-main' }] },
        { number: 2, labels: [{ name: 'parked' }] },
        { number: 3, labels: [{ name: 'ready' }] },
        { number: 4, labels: [{ name: 'ready' }] },
      ]]),
      stderr: '',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await backlogForecastCommand();

    expect(buildClassifyLookupsMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ labels: expect.any(Function) }));
    const output = JSON.parse(log.mock.calls[0]![0] as string);
    expect(output.stats).toMatchObject({
      blocksMain: 1,
      parked: 1,
      needsRelease: 1,
      needsPlanning: 1,
    });
    expect(output.needsPlanning).toEqual(['PAN-4']);
  });
});
