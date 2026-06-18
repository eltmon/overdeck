import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockGenerateSmartSummary } = vi.hoisted(() => ({
  mockGenerateSmartSummary: vi.fn(),
}));

vi.mock('../../../../lib/config-yaml.js', () => ({
  loadConfigSync: () => ({
    config: {
      conversations: {
        compactionModel: 'claude-haiku-4-5',
        manualCompactMode: 'panopticon-native',
        richCompaction: true,
      },
    },
  }),
}));

vi.mock('../../../../lib/conversations/smart-compaction.js', async () => {
  const { Effect } = await import('effect');
  return {
    generateSmartSummary: mockGenerateSmartSummary.mockImplementation((opts: { model?: string }) =>
      Effect.succeed({
        summary: `summary from ${opts.model ?? 'default'}`,
        tokensBefore: 42,
        firstKeptEntryIndex: 0,
        summaryModel: opts.model ?? null,
        readFiles: [],
        modifiedFiles: [],
      }),
    ),
  };
});

vi.mock('../../event-store.js', () => ({
  getEventStore: () => ({ emitOnly: vi.fn() }),
}));

vi.mock('../../../../lib/background-ai/features.js', () => ({
  isBackgroundFeatureEnabled: () => true,
}));

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pan-conversation-compaction-'));
  mockGenerateSmartSummary.mockClear();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function writeJsonl(name: string, lines: unknown[]): Promise<string> {
  return writeFile(join(workDir, name), lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf-8')
    .then(() => join(workDir, name));
}

describe('conversation native compaction', () => {
  it('writes the compact boundary to a forked file without mutating the source', async () => {
    const file = await writeJsonl('session.jsonl', [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Fix the broken deploy' }] } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'MiniMax-M2.7-highspeed',
          content: [{ type: 'text', text: 'I found the deploy issue.' }],
          usage: { input_tokens: 1000, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 },
        },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          model: '<synthetic>',
          content: [{ type: 'text', text: 'API Error' }],
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    const originalContent = await readFile(file, 'utf-8');

    const { compactConversationNative } = await import('../conversation-compaction.js');
    const result = await compactConversationNative(file);

    expect(mockGenerateSmartSummary).toHaveBeenCalledWith(expect.objectContaining({
      jsonlPath: file,
      model: 'claude-haiku-4-5',
      richMode: true,
      mode: 'fork',
    }));

    // Source file must be byte-for-byte unchanged (sacred-file invariant)
    const sourceAfter = await readFile(file, 'utf-8');
    expect(sourceAfter).toBe(originalContent);

    // Fork result must carry the new session identifiers
    expect(result.forkedSessionId).toBeTruthy();
    expect(result.forkedSessionFile).toBeTruthy();
    expect(result.forkedSessionFile).not.toBe(file);

    // Fork file must contain the compact boundary and summary
    const forkedContent = await readFile(result.forkedSessionFile, 'utf-8');
    expect(forkedContent).toContain('"subtype":"compact_boundary"');
    expect(forkedContent).toContain('summary from claude-haiku-4-5');
  });

  it('ignores trailing zero-token assistant usage when estimating context', async () => {
    const file = await writeJsonl('usage.jsonl', [
      {
        type: 'assistant',
        message: {
          usage: { input_tokens: 1000, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 },
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'synthetic error' }],
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);

    const { estimateContextTokens } = await import('../conversation-compaction.js');

    expect(await estimateContextTokens(file)).toBe(1500);
  });
});
