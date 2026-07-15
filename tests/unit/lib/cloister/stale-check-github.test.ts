import { execFile } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPrHead,
  listPrHeadFailingRuns,
  listRecentMainRuns,
  rerunFailedRun,
} from '../../../../src/lib/cloister/stale-check-github.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: vi.fn(),
}));

const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;

function respond(stdout: string, error: Error | null = null): void {
  execFileMock.mockImplementationOnce(
    (_file, _args, _options, callback: (err: Error | null, stdout: string, stderr: string) => void) =>
      callback(error, stdout, ''),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listRecentMainRuns', () => {
  it('lists recent main runs with the attempt field', async () => {
    const runs = [{ databaseId: 10, workflowName: 'CI', createdAt: '2026-07-15T10:00:00Z', conclusion: 'FAILURE', status: 'completed', attempt: 1, headSha: 'abc' }];
    respond(JSON.stringify(runs));

    await expect(listRecentMainRuns('eltmon/overdeck')).resolves.toEqual(runs);
    expect(execFileMock).toHaveBeenCalledWith('gh', [
      'run', 'list', '--repo', 'eltmon/overdeck', '--branch', 'main', '--limit', '50',
      '--json', 'databaseId,workflowName,createdAt,conclusion,status,attempt,headSha',
    ], { encoding: 'utf-8', timeout: 30000 }, expect.any(Function));
  });

  it('returns an empty list and warns when gh fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    respond('', new Error('offline'));

    await expect(listRecentMainRuns('eltmon/overdeck')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to list recent main runs'), 'offline');
  });
});

describe('listPrHeadFailingRuns', () => {
  it('keeps only runs for the current PR head SHA', async () => {
    const current = { databaseId: 20, workflowName: 'CI', createdAt: '2026-07-15T10:00:00Z', conclusion: 'FAILURE', status: 'completed', attempt: 1, headSha: 'current' };
    respond(JSON.stringify([current, { ...current, databaseId: 19, headSha: 'old' }]));

    await expect(listPrHeadFailingRuns('eltmon/overdeck', 'feature/pan-2710', 'current')).resolves.toEqual([current]);
    expect(execFileMock.mock.calls[0][1]).toEqual([
      'run', 'list', '--repo', 'eltmon/overdeck', '--branch', 'feature/pan-2710', '--commit', 'current',
      '--status', 'completed', '--limit', '100',
      '--json', 'databaseId,workflowName,createdAt,conclusion,status,attempt,headSha',
    ]);
  });

  it.each(['ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])(
    'keeps the canonical %s failing conclusion',
    async (conclusion) => {
      const failing = { databaseId: 20, workflowName: 'CI', createdAt: '2026-07-15T10:00:00Z', conclusion, status: 'completed', attempt: 1, headSha: 'current' };
      respond(JSON.stringify([failing]));

      await expect(listPrHeadFailingRuns('repo', 'branch', 'current')).resolves.toEqual([failing]);
    },
  );

  it('discards successful and incomplete runs before classification', async () => {
    const base = { databaseId: 20, workflowName: 'CI', createdAt: '2026-07-15T10:00:00Z', status: 'completed', attempt: 1, headSha: 'current' };
    respond(JSON.stringify([
      { ...base, conclusion: 'SUCCESS' },
      { ...base, databaseId: 21, conclusion: 'FAILURE', status: 'in_progress' },
    ]));

    await expect(listPrHeadFailingRuns('repo', 'branch', 'current')).resolves.toEqual([]);
  });

  it('returns an empty list and warns on malformed output', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    respond('not json');

    await expect(listPrHeadFailingRuns('repo', 'branch', 'sha')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('getPrHead', () => {
  it('returns the PR head ref and oid', async () => {
    respond('{"headRefName":"feature/pan-2710","headRefOid":"abc123"}');

    await expect(getPrHead('eltmon/overdeck', 42)).resolves.toEqual({
      headRefName: 'feature/pan-2710',
      headRefOid: 'abc123',
    });
    expect(execFileMock.mock.calls[0][1]).toEqual([
      'pr', 'view', '42', '--repo', 'eltmon/overdeck', '--json', 'headRefName,headRefOid',
    ]);
  });

  it('returns null and warns on failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    respond('', new Error('missing'));

    await expect(getPrHead('repo', 42)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('rerunFailedRun', () => {
  it('runs only failed jobs and returns true on success', async () => {
    respond('');

    await expect(rerunFailedRun('eltmon/overdeck', 123)).resolves.toBe(true);
    expect(execFileMock.mock.calls[0][1]).toEqual([
      'run', 'rerun', '123', '--failed', '--repo', 'eltmon/overdeck',
    ]);
  });

  it('returns false and warns on failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    respond('', new Error('expired'));

    await expect(rerunFailedRun('repo', 123)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });
});
