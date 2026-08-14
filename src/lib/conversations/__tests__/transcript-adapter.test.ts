import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

vi.mock('../../../dashboard/server/routes/jsonl-resolver.js', () => ({
  resolveCodexRolloutPath: vi.fn(),
}));

import {
  generateSmartSummary as mockedGenerateSmartSummary,
  summarizeSerializedText as mockedSummarize,
} from '../smart-compaction.js';
import { getTranscriptAdapter } from '../transcript-adapter.js';
import { kimiSessionsRoot } from '../../runtimes/kimi-code.js';
import { resolveCodexRolloutPath } from '../../../dashboard/server/routes/jsonl-resolver.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
const originalHome = process.env.HOME;
let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pan-transcript-adapter-'));
  process.env.OVERDECK_HOME = workDir;
  vi.mocked(mockedSummarize).mockClear();
  vi.mocked(mockedGenerateSmartSummary).mockClear();
});

afterEach(async () => {
  if (originalOverdeckHome === undefined) {
    delete process.env.OVERDECK_HOME;
  } else {
    process.env.OVERDECK_HOME = originalOverdeckHome;
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await rm(workDir, { recursive: true, force: true });
});

function writeJsonl(name: string, lines: unknown[]): Promise<string> {
  const path = join(workDir, name);
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  return writeFile(path, body, 'utf-8').then(() => path);
}

describe('ConversationTranscriptAdapter.compactSummary', () => {
  it('registers Codex with its own source capabilities', () => {
    const adapter = getTranscriptAdapter('codex');

    expect(adapter.name).toBe('codex');
    expect(adapter.supportsPlainForkAsSource).toBe(false);
    expect(adapter.supportsSourceAuthoredHandoff).toBe(true);
  });

  it('serializes visible Codex rollout messages and tool calls', async () => {
    const file = join(workDir, 'codex-rollout.jsonl');
    await writeFile(file, [
      JSON.stringify({ type: 'session_meta', payload: { id: 't1' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'hello codex' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', summary: [] } }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls"}' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch' },
      }),
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', output: 'file.txt' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'done' } }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 10 } } },
      }),
      'garbage non-JSON line',
    ].join('\n') + '\n', 'utf-8');

    const serialized = await getTranscriptAdapter('codex').serializeTranscript(file);

    expect(serialized).toContain('[user]\nhello codex');
    expect(serialized).toContain('[tool_use: exec_command]');
    const customToolCall = serialized.split('\n\n').find((part) => part.startsWith('[tool_use: apply_patch]'));
    expect(customToolCall).toContain(JSON.stringify('*** Begin Patch'));
    expect(serialized).toContain('[assistant]\ndone');
    expect(serialized).not.toContain('file.txt');
    expect(serialized).not.toContain('reasoning');
    expect(serialized).not.toContain('token_count');
    expect(serialized).not.toContain('garbage non-JSON line');
  });

  it('resolves a Codex rollout from the conversation tmux session', async () => {
    const rolloutPath = join(workDir, 'rollout-test.jsonl');
    vi.mocked(resolveCodexRolloutPath).mockResolvedValueOnce(rolloutPath);
    const adapter = getTranscriptAdapter('codex');
    const conv = { tmuxSession: 'conv-codex-source' } as Parameters<typeof adapter.resolveSessionFile>[0];

    await expect(adapter.resolveSessionFile(conv)).resolves.toBe(rolloutPath);
    expect(resolveCodexRolloutPath).toHaveBeenCalledWith('conv-codex-source');
  });

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

  it('resolves, serializes, and compacts an ACP source transcript', async () => {
    const adapter = getTranscriptAdapter('acp');
    const tmuxSession = 'conv-acp-source';
    const agentDir = join(workDir, 'agents', tmuxSession);
    const file = join(agentDir, 'acp-session.jsonl');
    const oversizedToolCommand = `${'x'.repeat(600)}TOOL_COMMAND_TAIL_MUST_NOT_APPEAR`;
    await mkdir(agentDir, { recursive: true });
    await writeFile(file, [
      JSON.stringify({
        timestamp: '2026-07-18T00:00:00.000Z',
        role: 'user',
        content: 'Continue the ACP runtime work',
      }),
      '{malformed',
      JSON.stringify({
        timestamp: '2026-07-18T00:00:01.000Z',
        role: 'assistant',
        content: 'I will inspect the host lifecycle',
      }),
      JSON.stringify({
        timestamp: '2026-07-18T00:00:02.000Z',
        role: 'tool',
        content: 'Read host.ts',
        toolCalls: [{
          toolCallId: 'tool-1',
          kind: 'read',
          title: 'Read',
          status: 'completed',
          command: oversizedToolCommand,
          detail: 'Inspected the ACP host',
          data: { rawOutput: 'UNBOUNDED_TOOL_DATA_MUST_NOT_APPEAR' },
        }],
      }),
    ].join('\n') + '\n', 'utf-8');

    expect(adapter.name).toBe('acp');
    expect(adapter.supportsPlainForkAsSource).toBe(false);
    expect(adapter.supportsSourceAuthoredHandoff).toBe(false);
    await expect(adapter.resolveSessionFile({ tmuxSession } as Parameters<typeof adapter.resolveSessionFile>[0])).resolves.toBe(file);

    const serialized = await adapter.serializeTranscript(file);
    expect(serialized).toContain('[user]\nContinue the ACP runtime work');
    expect(serialized).toContain('[assistant]\nI will inspect the host lifecycle');
    expect(serialized).toContain('[tool_use: Read (completed)]');
    expect(serialized).toContain('Inspected the ACP host');
    expect(serialized).not.toContain('UNBOUNDED_TOOL_DATA_MUST_NOT_APPEAR');
    expect(serialized).not.toContain('TOOL_COMMAND_TAIL_MUST_NOT_APPEAR');
    expect(serialized).not.toContain('{malformed');

    const { summary, summaryModel } = await adapter.compactSummary(file, {
      model: 'claude-haiku-4-5',
      includeThinking: false,
    });
    expect(summary).toContain('Continue the ACP runtime work');
    expect(summaryModel).toBe('claude-haiku-4-5');
    expect(mockedSummarize).toHaveBeenCalledTimes(1);
    expect(mockedGenerateSmartSummary).not.toHaveBeenCalled();
  });

  it('resolves, serializes, and compacts a native Kimi Code source transcript (PAN-1837)', async () => {
    process.env.HOME = workDir;
    const workspace = join(workDir, 'kimi-workspace');
    await mkdir(workspace, { recursive: true });
    const tmuxSession = 'conv-kimi-source';
    const kimiHome = join(workDir, '.kimi-code');
    const sessionDir = join(kimiSessionsRoot(kimiHome, workspace), 'session-abc', 'agents', 'main');
    await mkdir(sessionDir, { recursive: true });
    const file = join(sessionDir, 'wire.jsonl');
    await writeFile(file, [
      JSON.stringify({ type: 'metadata', created_at: 1 }),
      JSON.stringify({
        type: 'turn.prompt',
        time: 1,
        input: [{ type: 'text', text: 'Continue the kimi-code work' }],
      }),
      '{malformed',
      JSON.stringify({
        type: 'context.append_loop_event',
        time: 2,
        event: { type: 'content.part', part: { type: 'text', text: 'I will inspect the runtime adapter' } },
      }),
      JSON.stringify({
        type: 'context.append_loop_event',
        time: 3,
        event: { type: 'tool.call', toolCallId: 'call-1', name: 'Read', args: { file: 'kimi-code.ts' } },
      }),
      JSON.stringify({
        type: 'context.append_loop_event',
        time: 4,
        event: { type: 'tool.result', toolCallId: 'call-1', result: { output: 'UNBOUNDED_TOOL_OUTPUT_MUST_NOT_APPEAR' } },
      }),
    ].join('\n') + '\n', 'utf-8');

    const adapter = getTranscriptAdapter('kimi-code');
    expect(adapter.name).toBe('kimi-code');
    expect(adapter.supportsPlainForkAsSource).toBe(false);
    expect(adapter.supportsSourceAuthoredHandoff).toBe(false);

    const conv = { tmuxSession, cwd: workspace } as Parameters<typeof adapter.resolveSessionFile>[0];
    await expect(adapter.resolveSessionFile(conv)).resolves.toBe(file);

    const serialized = await adapter.serializeTranscript(file);
    expect(serialized).toContain('[user]\nContinue the kimi-code work');
    expect(serialized).toContain('[assistant]\nI will inspect the runtime adapter');
    expect(serialized).toContain('[tool_use: Read]');
    expect(serialized).not.toContain('UNBOUNDED_TOOL_OUTPUT_MUST_NOT_APPEAR');
    expect(serialized).not.toContain('{malformed');

    const { summary, summaryModel } = await adapter.compactSummary(file, {
      model: 'claude-haiku-4-5',
      includeThinking: false,
    });
    expect(summary).toContain('Continue the kimi-code work');
    expect(summaryModel).toBe('claude-haiku-4-5');
    expect(mockedSummarize).toHaveBeenCalledTimes(1);
    expect(mockedGenerateSmartSummary).not.toHaveBeenCalled();
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
    expect(getTranscriptAdapter('kimi-code').name).toBe('kimi-code');
    expect(getTranscriptAdapter(undefined).name).toBe('claude-code');
  });
});
