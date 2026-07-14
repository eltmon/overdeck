import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

// Mock only execFileAsync on shared.js; everything else stays real so the
// real withBdMutex runs and we prove its failure-channel conversion is folded
// into a value rather than escaping the fiber (the 500 bug this guards).
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('../agents/shared.js', async (importActual) => {
  const actual = await importActual<typeof import('../agents/shared.js')>();
  return { ...actual, execFileAsync: execFileMock };
});

import { countTasksForIssue } from '../agents/spawn.js';

describe('countTasksForIssue — bd failures must never escape as a 500', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when `bd list` exits non-zero (e.g. Linear never pulled) instead of failing the Effect', async () => {
    // Reproduces the production log: bd exits non-zero and its stderr warning is
    // carried in the rejection message. A bare try/catch could not catch this
    // because withBdMutex turns it into an Effect error-channel failure.
    execFileMock.mockRejectedValue(new Error(
      "Command failed: bd list --json -l pan-2255 --status all --limit 0\n"
      + "⚠ Linear data has never been pulled — run 'bd linear sync --pull' to import",
    ));

    const count = await Effect.runPromise(countTasksForIssue('/ws/pan-2255', 'pan-2255'));
    expect(count).toBe(0);
    expect(execFileMock).toHaveBeenCalledWith(
      'bd',
      ['list', '--json', '-l', 'pan-2255', '--status', 'all', '--limit', '0'],
      expect.objectContaining({ cwd: '/ws/pan-2255', timeout: 10000 }),
    );
  });

  it('returns the task count parsed from valid bd JSON output', async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
      stderr: '',
    });

    const count = await Effect.runPromise(countTasksForIssue('/ws/pan-1', 'pan-1'));
    expect(count).toBe(3);
  });

  it('returns 0 for empty bd output', async () => {
    execFileMock.mockResolvedValue({ stdout: '', stderr: '' });

    const count = await Effect.runPromise(countTasksForIssue('/ws/pan-2', 'pan-2'));
    expect(count).toBe(0);
  });

  it('returns 0 when bd output is not parseable JSON rather than throwing', async () => {
    execFileMock.mockResolvedValue({ stdout: 'not json at all', stderr: '' });

    const count = await Effect.runPromise(countTasksForIssue('/ws/pan-3', 'pan-3'));
    expect(count).toBe(0);
  });
});
