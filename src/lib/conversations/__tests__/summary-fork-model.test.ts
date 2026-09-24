import { beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-4160: the fork-summary model comes from the request or from
// conversations.fork_summary_model — never from a literal in summary-fork.ts.
const mocks = vi.hoisted(() => ({
  forkSummaryModel: undefined as string | undefined,
  compactSummary: vi.fn(),
}));

vi.mock('../../config-yaml.js', async () => {
  const actual = await vi.importActual<typeof import('../../config-yaml.js')>('../../config-yaml.js');
  return {
    ...actual,
    loadConfigSync: () => {
      const real = actual.loadConfigSync();
      return {
        ...real,
        config: {
          ...real.config,
          conversations: { ...real.config.conversations, forkSummaryModel: mocks.forkSummaryModel },
        },
      };
    },
  };
});

vi.mock('../transcript-adapter.js', () => ({
  getTranscriptAdapter: () => ({ compactSummary: mocks.compactSummary }),
}));

import { generateSummaryForFork } from '../summary-fork.js';

describe('generateSummaryForFork model resolution (PAN-4160)', () => {
  beforeEach(() => {
    mocks.compactSummary.mockReset().mockResolvedValue({ summary: 'S' });
  });

  it('uses conversations.fork_summary_model when the request names no model', async () => {
    mocks.forkSummaryModel = 'cfg-fork-summary-model';

    const result = await generateSummaryForFork('/tmp/pan-4160.jsonl');

    expect(mocks.compactSummary).toHaveBeenCalledWith(
      '/tmp/pan-4160.jsonl',
      expect.objectContaining({ model: 'cfg-fork-summary-model' }),
    );
    expect(result.summaryModel).toBe('cfg-fork-summary-model');
  });

  it('prefers the request-level model over the configured one', async () => {
    mocks.forkSummaryModel = 'cfg-fork-summary-model';

    await generateSummaryForFork('/tmp/pan-4160.jsonl', 'request-model');

    expect(mocks.compactSummary).toHaveBeenCalledWith(
      '/tmp/pan-4160.jsonl',
      expect.objectContaining({ model: 'request-model' }),
    );
  });

  it('fails loudly instead of picking a model when none is configured', async () => {
    mocks.forkSummaryModel = undefined;

    await expect(generateSummaryForFork('/tmp/pan-4160.jsonl')).rejects.toThrow(
      /No fork summary model configured: set conversations\.fork_summary_model/,
    );
    expect(mocks.compactSummary).not.toHaveBeenCalled();
  });
});
