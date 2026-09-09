import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ stat: vi.fn(), job: vi.fn() }));
vi.mock('node:fs/promises', () => ({ stat: mocks.stat }));
vi.mock('../dashboard-db-task.js', () => ({ runDashboardDbJob: mocks.job }));
import { sharedTranscriptParser } from '../shared-transcript-parser.js';

describe('shared transcript parser', () => {
  it('shares one worker parse among subscribers, refreshes changed files, and retries failures', async () => {
    mocks.stat.mockResolvedValue({ dev: 1, ino: 1, size: 100, mtimeMs: 1 });
    const result = { messages: [], workLog: [] };
    mocks.job.mockResolvedValue(result);
    const first = sharedTranscriptParser('codex');
    const second = sharedTranscriptParser('codex');
    expect(await Promise.all([first('/shared.jsonl'), second('/shared.jsonl')])).toEqual([result, result]);
    expect(mocks.job).toHaveBeenCalledTimes(1);
    mocks.stat.mockResolvedValue({ dev: 1, ino: 1, size: 200, mtimeMs: 2 });
    mocks.job.mockRejectedValueOnce(new Error('transient read failure'));
    await expect(first('/shared.jsonl')).rejects.toThrow('transient read failure');
    expect(await second('/shared.jsonl')).toBe(result);
    expect(mocks.job).toHaveBeenCalledTimes(3);
  });
});
