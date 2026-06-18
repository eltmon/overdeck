import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const { mockGenerateSmartSummary } = vi.hoisted(() => ({
  mockGenerateSmartSummary: vi.fn(),
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

vi.mock('../../../../lib/agents.js', () => ({
  getAgentRuntimeBaseCommand: vi.fn(async () => 'claude'),
  getProviderExportsForModel: vi.fn(async () => ''),
}));

let TEST_HOME: string;
let CONFIG_HOME: string;
const ORIGINAL_HOME = process.env.HOME;

beforeEach(() => {
  mockGenerateSmartSummary.mockClear();
  TEST_HOME = join(tmpdir(), `pan-compaction-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  CONFIG_HOME = join(tmpdir(), `pan-compaction-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(CONFIG_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
  process.env.HOME = CONFIG_HOME;
  mkdirSync(join(CONFIG_HOME, '.panopticon'), { recursive: true });
  writeFileSync(
    join(CONFIG_HOME, '.panopticon', 'config.yaml'),
    [
      'conversations:',
      '  compaction_model: claude-haiku-4-5',
      '  manual_compact_mode: panopticon-native',
      '',
    ].join('\n')
  );
});

afterEach(() => {
  delete process.env.OVERDECK_HOME;
  if (ORIGINAL_HOME) {
    process.env.HOME = ORIGINAL_HOME;
  } else {
    delete process.env.HOME;
  }
  rmSync(TEST_HOME, { recursive: true, force: true });
  rmSync(CONFIG_HOME, { recursive: true, force: true });
});

describe('conversation compaction service', () => {
  it('creates a forked file with the compact boundary without mutating the source', async () => {
    const sessionFile = join(TEST_HOME, 'session.jsonl');
    const sourceLines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Fix the compact bug' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: '/tmp/file.ts' } }],
          usage: { input_tokens: 1200 },
        },
      }),
    ].join('\n') + '\n';
    writeFileSync(sessionFile, sourceLines);

    const { compactConversationNative, shouldInterceptManualCompact } = await import('../../services/conversation-compaction.js');
    const result = await compactConversationNative(sessionFile);

    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.summary).toContain('This session is being continued from a previous conversation');
    expect(result.forkedSessionId).toBeTruthy();
    expect(result.forkedSessionFile).not.toBe(sessionFile);
    expect(shouldInterceptManualCompact('/compact')).toBe(true);

    // Source file must NOT be modified (sacred-file invariant)
    const sourceContent = await import('node:fs/promises').then((fs) => fs.readFile(sessionFile, 'utf-8'));
    expect(sourceContent).toBe(sourceLines);

    // Fork file must contain the compact boundary and summary
    const forkContent = await import('node:fs/promises').then((fs) => fs.readFile(result.forkedSessionFile, 'utf-8'));
    expect(forkContent).toContain('"subtype":"compact_boundary"');
    expect(forkContent).toContain('This session is being continued from a previous conversation');
  });
});
