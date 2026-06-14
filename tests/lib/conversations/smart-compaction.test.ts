import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import * as smartCompaction from '../../../src/lib/conversations/smart-compaction.js';

const { generateSummaryFromPrompt, truncateHeadTail } = smartCompaction;

const OVERFLOW_ERROR = new Error(
  'Summary generation failed: {"result":"Prompt is too long","terminal_reason":"blocking_limit"}',
);

describe('truncateHeadTail', () => {
  it('returns short input unchanged', () => {
    expect(truncateHeadTail('hello', 100)).toBe('hello');
  });

  it('preserves head and tail with an elision marker and reports truncated count', () => {
    const input = 'A'.repeat(50) + 'B'.repeat(50) + 'C'.repeat(50);
    const ceiling = 80;
    const result = truncateHeadTail(input, ceiling);

    expect(result).toContain('[... 70 characters truncated ...]');
    expect(result.startsWith('A'.repeat(40))).toBe(true);
    expect(result.endsWith('C'.repeat(40))).toBe(true);
    expect(result.length).toBeLessThanOrEqual(
      ceiling + '[... 70 characters truncated ...]'.length,
    );
  });
});

describe('generateSummaryFromPrompt', () => {
  let runModelSummarySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runModelSummarySpy = vi.spyOn(smartCompaction, 'runModelSummary');
  });

  afterEach(() => {
    runModelSummarySpy.mockRestore();
  });

  it('truncates head+tail and retries once on context overflow', async () => {
    runModelSummarySpy
      .mockImplementationOnce(() => Effect.fail(OVERFLOW_ERROR))
      .mockImplementationOnce(() => Effect.succeed('degraded summary'));

    const serialized = 'x'.repeat(500_000);
    const previousSummary = 'prev'.repeat(10_000);
    const result = await generateSummaryFromPrompt(serialized, previousSummary, undefined, false);

    expect(result).toBe('degraded summary');
    expect(runModelSummarySpy).toHaveBeenCalledTimes(2);

    const [firstPrompt, secondPrompt] = runModelSummarySpy.mock.calls.map(
      call => call[0] as string,
    );
    expect(secondPrompt.length).toBeLessThan(firstPrompt.length);
    expect(secondPrompt).toContain('[...');
    expect(secondPrompt).toContain('x'.repeat(100));
    expect(secondPrompt).toContain('prev'.repeat(100));
  });

  it('rejects when the truncated retry also overflows', async () => {
    runModelSummarySpy.mockImplementation(() => Effect.fail(OVERFLOW_ERROR),
    );

    await expect(
      generateSummaryFromPrompt('x'.repeat(500_000), undefined, undefined, false),
    ).rejects.toThrow('blocking_limit');
    expect(runModelSummarySpy).toHaveBeenCalledTimes(2);
  });

  it('returns the first successful summary and does not retry', async () => {
    runModelSummarySpy.mockImplementation(() => Effect.succeed('full summary'));

    const result = await generateSummaryFromPrompt('small transcript', undefined, undefined, false);

    expect(result).toBe('full summary');
    expect(runModelSummarySpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry on non-overflow errors', async () => {
    runModelSummarySpy.mockImplementationOnce(() => Effect.fail(new Error('ENOENT: no such file')));

    await expect(
      generateSummaryFromPrompt('small transcript', undefined, undefined, false),
    ).rejects.toThrow('ENOENT');
    expect(runModelSummarySpy).toHaveBeenCalledTimes(1);
  });
});
