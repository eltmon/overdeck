import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCodexConversationMessages } from '../codex-conversation-parser.js';

/**
 * Minimal Codex rollout fixture (cli ≥ 0.137.0 nested schema). Covers the
 * record kinds the display adapter must handle and the ones it must skip.
 */
const ROLLOUT_LINES = [
  // session_meta — ignored
  { type: 'session_meta', timestamp: '2026-06-09T00:10:50.132Z', payload: { id: 'thread-1', model_provider: 'openai' } },
  // turn_context — ignored
  { type: 'turn_context', timestamp: '2026-06-09T00:10:50.140Z', payload: { turn_id: 't1' } },
  // injected AGENTS.md context as a response_item message — must be skipped
  { type: 'response_item', timestamp: '2026-06-09T00:10:50.146Z', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions> ...' }] } },
  // the actual user prompt
  { type: 'event_msg', timestamp: '2026-06-09T00:10:50.152Z', payload: { type: 'user_message', message: 'fix the bug' } },
  // encrypted reasoning — must be skipped
  { type: 'response_item', timestamp: '2026-06-09T00:10:52.771Z', payload: { type: 'reasoning', summary: [], encrypted_content: 'gAAAA...' } },
  // assistant commentary
  { type: 'event_msg', timestamp: '2026-06-09T00:10:57.705Z', payload: { type: 'agent_message', message: 'Checking the branch first.' } },
  // tool call + its output (matched by call_id)
  { type: 'response_item', timestamp: '2026-06-09T00:10:57.707Z', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'git status', workdir: '/repo' }), call_id: 'call_1' } },
  { type: 'response_item', timestamp: '2026-06-09T00:10:57.840Z', payload: { type: 'function_call_output', call_id: 'call_1', output: 'Output:\nclean\n' } },
  // final assistant answer
  { type: 'event_msg', timestamp: '2026-06-09T00:11:05.000Z', payload: { type: 'agent_message', message: 'Done — the bug is fixed.' } },
  // cumulative usage — latest wins
  { type: 'event_msg', timestamp: '2026-06-09T00:10:58.847Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 31380, cached_input_tokens: 4480, output_tokens: 328, total_tokens: 31708 } } } },
  { type: 'event_msg', timestamp: '2026-06-09T00:11:06.000Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 60000, cached_input_tokens: 8000, output_tokens: 700, total_tokens: 60700 } } } },
];

describe('codex conversation parser', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'codex-parse-'));
    file = join(dir, 'rollout-2026-06-08T20-10-44-thread-1.jsonl');
    await writeFile(file, ROLLOUT_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts user and assistant turns from event_msg, skipping injected context and reasoning', async () => {
    const result = await parseCodexConversationMessages(file);

    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(result.messages[0]?.text).toBe('fix the bug');
    expect(result.messages[1]?.text).toBe('Checking the branch first.');
    expect(result.messages[2]?.text).toBe('Done — the bug is fixed.');
    // The injected AGENTS.md developer message must NOT surface as a user turn.
    expect(result.messages.some((m) => m.text.includes('permissions instructions'))).toBe(false);
  });

  it('pairs a function_call with its output into one work-log entry, extracting the shell command', async () => {
    const result = await parseCodexConversationMessages(file);

    const shell = result.workLog.find((w) => w.command === 'git status');
    expect(shell).toBeDefined();
    expect(shell?.label).toBe('Shell');
    expect(shell?.result).toContain('clean');
    // One entry for the call+output pair, not two.
    expect(result.workLog.filter((w) => w.id === 'call_1')).toHaveLength(1);
  });

  it('reports the latest cumulative token total and interleaves sequences monotonically', async () => {
    const result = await parseCodexConversationMessages(file);

    expect(result.totalTokens).toBe(60700);
    expect(result.totalCost).toBe(0);
    const seqs = [...result.messages, ...result.workLog].map((x) => x.sequence ?? 0);
    const sorted = [...seqs].sort((a, b) => a - b);
    expect(seqs.length).toBeGreaterThan(0);
    expect(new Set(seqs).size).toBe(seqs.length); // all unique
    // A single shared counter across messages + workLog yields contiguous 1..N,
    // so re-sorting by sequence reconstructs original file order in the UI.
    expect(sorted).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });
});
