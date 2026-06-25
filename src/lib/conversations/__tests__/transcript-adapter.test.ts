import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the two summarizer seams the adapters call across the module boundary.
// The Pi adapter calls summarizeSerializedText (echo it so tests can assert the
// serialized Pi transcript actually reached the summarizer — the core PAN-1540
// fix); the Claude adapter calls generateSmartSummary (return a known result).
// Spreading `...actual` keeps the real serializers (parseEntries /
// serializeConversation and the Pi line parser) intact.
vi.mock('../smart-compaction.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../smart-compaction.js')>();
  const { Effect } = await import('effect');
  return {
    ...actual,
    summarizeSerializedText: vi.fn(async (serialized: string) => `SUMMARY-OF:\n${serialized}`),
    generateSmartSummary: vi.fn((opts: { model?: string }) =>
      Effect.succeed({
        summary: `CC-SUMMARY model=${opts.model ?? 'default'}`,
        tokensBefore: 0,
        firstKeptEntryIndex: 0,
        summaryModel: opts.model ?? null,
        readFiles: [],
        modifiedFiles: [],
      }),
    ),
  };
});

import {
  generateSmartSummary as mockedGenerateSmartSummary,
  summarizeSerializedText as mockedSummarize,
} from '../smart-compaction.js';
import { getTranscriptAdapter } from '../transcript-adapter.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pan-transcript-adapter-'));
  vi.mocked(mockedSummarize).mockClear();
  vi.mocked(mockedGenerateSmartSummary).mockClear();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function writeJsonl(name: string, lines: unknown[]): Promise<string> {
  const path = join(workDir, name);
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  return writeFile(path, body, 'utf-8').then(() => path);
}

describe('ConversationTranscriptAdapter.compactSummary', () => {
  it('produces a non-empty summary from a Pi source transcript', async () => {
    // Pi records: top-level type:'message', role nested in message.role,
    // blocks of type text/thinking/toolCall.
    const file = await writeJsonl('pi-session.jsonl', [
      { type: 'session', id: 'abc' },
      {
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: 'Refactor the auth module please' }] },
      },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will start by reading auth.ts' },
            { type: 'toolCall', name: 'Read', arguments: { file: 'auth.ts' } },
          ],
        },
      },
    ]);

    const adapter = getTranscriptAdapter('ohmypi');
    const { summary } = await adapter.compactSummary(file, { model: 'claude-haiku-4-5', includeThinking: false });

    expect(summary.trim().length).toBeGreaterThan(0);
    // The serialized Pi turns must have reached the summarizer — that is exactly
    // what was broken before (Pi JSONL fed through the Claude parser produced an
    // empty transcript and a useless summary).
    expect(mockedSummarize).toHaveBeenCalledTimes(1);
    const serialized = vi.mocked(mockedSummarize).mock.calls[0]?.[0] as string;
    expect(serialized).toContain('[user]');
    expect(serialized).toContain('Refactor the auth module please');
    expect(serialized).toContain('[assistant]');
    expect(serialized).toContain('I will start by reading auth.ts');
    expect(serialized).toContain('[tool_use: Read]');
    expect(summary).toContain('Refactor the auth module please');
    // Pi does not use the Claude entry-aware path.
    expect(mockedGenerateSmartSummary).not.toHaveBeenCalled();
  });

  it('returns an empty summary (no LLM call) when the Pi transcript has no recognizable turns', async () => {
    const file = await writeJsonl('pi-empty.jsonl', [
      { type: 'session', id: 'abc' },
      { type: 'model_change', model: 'x' },
    ]);

    const adapter = getTranscriptAdapter('ohmypi');
    const { summary, summaryModel } = await adapter.compactSummary(file, { model: 'claude-haiku-4-5' });

    expect(summary).toBe('');
    expect(summaryModel).toBeNull();
    expect(mockedSummarize).not.toHaveBeenCalled();
  });

  it('routes a Claude Code source through the entry-aware smart-compaction path', async () => {
    const file = await writeJsonl('cc-session.jsonl', [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Fix the failing test in foo.spec.ts' }] } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Looking at foo.spec.ts now' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'foo.spec.ts' } },
          ],
        },
      },
    ]);

    const adapter = getTranscriptAdapter('claude-code');
    const { summary, summaryModel } = await adapter.compactSummary(file, { model: 'claude-haiku-4-5' });

    expect(summary).toContain('CC-SUMMARY');
    expect(summaryModel).toBe('claude-haiku-4-5');
    expect(mockedGenerateSmartSummary).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(mockedGenerateSmartSummary).mock.calls[0]?.[0];
    expect(opts?.jsonlPath).toBe(file);
    expect(opts?.mode).toBe('fork');
    // Claude does not use the generic text summarizer.
    expect(mockedSummarize).not.toHaveBeenCalled();
  });

  it('selects the source adapter independently of the summarizer harness', () => {
    expect(getTranscriptAdapter('ohmypi').name).toBe('ohmypi');
    expect(getTranscriptAdapter('claude-code').name).toBe('claude-code');
    expect(getTranscriptAdapter(undefined).name).toBe('claude-code');
  });
});
