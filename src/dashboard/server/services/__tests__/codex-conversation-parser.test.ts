import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCodexConversationMessages } from '../codex-conversation-parser.js';
import { summarizeConversationActivity } from '../conversation-service.js';

/**
 * Minimal Codex rollout fixture (cli ≥ 0.137.0 nested schema). Covers the
 * record kinds the display adapter must handle and the ones it must skip.
 */
const ROLLOUT_LINES = [
  // session_meta — ignored
  { type: 'session_meta', timestamp: '2026-06-09T00:10:50.132Z', payload: { id: 'thread-1', model_provider: 'openai' } },
  // turn_context — ignored
  { type: 'turn_context', timestamp: '2026-06-09T00:10:50.140Z', payload: { turn_id: 't1', model: 'gpt-5.5' } },
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

/**
 * The same conversation as written by codex-cli >= 0.153.4 (PAN-3781), trimmed
 * from a real gpt-6-astra rollout. `user_message`/`agent_message` are gone —
 * both arrive as `item_completed` items keyed by PascalCase variant name. Note
 * the content `type` casing genuinely differs between the two variants, and the
 * attachment turn carries a non-text part that must drop out.
 */
const ITEM_COMPLETED_ROLLOUT_LINES = [
  { type: 'session_meta', timestamp: '2026-09-07T21:50:12.646Z', payload: { id: 'thread-2', model_provider: 'openai' } },
  { type: 'turn_context', timestamp: '2026-09-07T21:50:12.700Z', payload: { turn_id: 't1', model: 'gpt-6-astra' } },
  // Injected context still arrives as a response_item message — must be skipped.
  { type: 'response_item', timestamp: '2026-09-07T21:50:13.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<injected AGENTS.md context> ...' }] } },
  // User turn — lowercase 'text' part, plus an image part with no text.
  { type: 'event_msg', timestamp: '2026-09-07T21:50:14.000Z', payload: { type: 'item_completed', item: { type: 'UserMessage', id: 'um_1', content: [{ type: 'text', text: 'fix the bug' }, { type: 'image', image_url: 'file:///screenshot.png' }] } } },
  // Assistant narration — capitalised 'Text' part, commentary phase.
  { type: 'event_msg', timestamp: '2026-09-07T21:50:18.901Z', payload: { type: 'item_completed', item: { type: 'AgentMessage', id: 'am_1', content: [{ type: 'Text', text: 'Checking the branch first.' }], phase: 'commentary' } } },
  // Tool activity still comes from response_item — the CommandExecution item
  // below must NOT produce a second work-log row for the same command.
  { type: 'response_item', timestamp: '2026-09-07T21:50:19.000Z', payload: { type: 'custom_tool_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'git status', workdir: '/repo' }), call_id: 'call_1' } },
  { type: 'event_msg', timestamp: '2026-09-07T21:50:19.100Z', payload: { type: 'item_completed', item: { type: 'CommandExecution', id: 'ce_1', command: 'git status' } } },
  { type: 'response_item', timestamp: '2026-09-07T21:50:19.200Z', payload: { type: 'custom_tool_call_output', call_id: 'call_1', output: 'Output:\nclean\n' } },
  // Reasoning item — skipped like the legacy encrypted reasoning record.
  { type: 'event_msg', timestamp: '2026-09-07T21:50:20.000Z', payload: { type: 'item_completed', item: { type: 'Reasoning', id: 'r_1', content: [{ type: 'Text', text: 'internal chain of thought' }] } } },
  // Final answer.
  { type: 'event_msg', timestamp: '2026-09-07T21:50:25.000Z', payload: { type: 'item_completed', item: { type: 'AgentMessage', id: 'am_2', content: [{ type: 'Text', text: 'Done — the bug is fixed.' }], phase: 'final_answer' } } },
  { type: 'event_msg', timestamp: '2026-09-07T21:50:26.000Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 60000, cached_input_tokens: 8000, output_tokens: 700, total_tokens: 60700 } } } },
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
    // Cost is derived from the canonical Codex cost parser (gpt-5.5 pricing on
    // the token_count usage), so it is non-zero rather than a hardcoded 0.
    expect(result.totalCost).toBeGreaterThan(0);
    const seqs = [...result.messages, ...result.workLog].map((x) => x.sequence ?? 0);
    const sorted = [...seqs].sort((a, b) => a - b);
    expect(seqs.length).toBeGreaterThan(0);
    expect(new Set(seqs).size).toBe(seqs.length); // all unique
    // A single shared counter across messages + workLog yields contiguous 1..N,
    // so re-sorting by sequence reconstructs original file order in the UI.
    expect(sorted).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });

  it('summarizes a completed Codex turn as not working even when the tmux session is alive', async () => {
    const result = await summarizeConversationActivity(file, { harness: 'codex' });

    expect(result.isWorking).toBe(false);
    expect(result.currentTool).toBeNull();
  });

  it('summarizes an unmatched Codex tool call as the current tool while fresh', async () => {
    const pendingToolFile = join(dir, 'rollout-pending-tool.jsonl');
    const lines = [
      { type: 'event_msg', timestamp: '2026-06-09T00:10:50.152Z', payload: { type: 'user_message', message: 'run tests' } },
      { type: 'response_item', timestamp: '2026-06-09T00:10:57.707Z', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }), call_id: 'call_pending' } },
    ];
    await writeFile(pendingToolFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');

    const result = await summarizeConversationActivity(pendingToolFile, { harness: 'codex' });

    expect(result.isWorking).toBe(true);
    expect(result.currentTool).toBe('Shell');
  });

  it('keeps a narrated mid-turn Codex conversation "working" while tools run after the last message', async () => {
    // The bug in PAN-3770: codex narrates ("Checking the branch first.") and
    // then runs tools. The completed-looking assistant message must not end
    // the turn while tool activity follows it.
    const midTurnFile = join(dir, 'rollout-mid-turn.jsonl');
    const lines = [
      { type: 'event_msg', timestamp: new Date(Date.now() - 30_000).toISOString(), payload: { type: 'user_message', message: 'check the config' } },
      { type: 'event_msg', timestamp: new Date(Date.now() - 25_000).toISOString(), payload: { type: 'agent_message', message: 'Checking the branch first.' } },
      { type: 'response_item', timestamp: new Date(Date.now() - 20_000).toISOString(), payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'git status' }), call_id: 'call_mid' } },
      { type: 'response_item', timestamp: new Date(Date.now() - 15_000).toISOString(), payload: { type: 'function_call_output', call_id: 'call_mid', output: 'Output:\nclean\n' } },
    ];
    await writeFile(midTurnFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');

    const result = await summarizeConversationActivity(midTurnFile, { harness: 'codex' });
    expect(result.isWorking).toBe(true);
  });

  it('marks a Codex turn complete when the final agent message trails all tool activity', async () => {
    const doneFile = join(dir, 'rollout-done.jsonl');
    const lines = [
      { type: 'event_msg', timestamp: new Date(Date.now() - 60_000).toISOString(), payload: { type: 'user_message', message: 'fix the bug' } },
      { type: 'response_item', timestamp: new Date(Date.now() - 50_000).toISOString(), payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'git status' }), call_id: 'call_done' } },
      { type: 'event_msg', timestamp: new Date(Date.now() - 5_000).toISOString(), payload: { type: 'agent_message', message: 'Done.' } },
      // usage tail after the final message is normal and must not un-complete the turn
      { type: 'event_msg', timestamp: new Date(Date.now() - 4_000).toISOString(), payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } } },
    ];
    await writeFile(doneFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');

    const result = await summarizeConversationActivity(doneFile, { harness: 'codex' });
    expect(result.isWorking).toBe(false);
  });
});

/**
 * PAN-3781 — codex-cli >= 0.153.4 renamed the rollout's message events. Every
 * assertion here has a twin in the legacy suite above; both shapes must render
 * identically, because old rollouts on disk keep the old names forever.
 */
describe('codex conversation parser — cli >= 0.153.4 item_completed shape', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'codex-parse-item-'));
    file = join(dir, 'rollout-2026-09-07T17-50-12-thread-2.jsonl');
    await writeFile(file, ITEM_COMPLETED_ROLLOUT_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts user and assistant turns from item_completed, across both content-type casings', async () => {
    const result = await parseCodexConversationMessages(file);

    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
    // Lowercase 'text' part on UserMessage; the image part contributes nothing.
    expect(result.messages[0]?.text).toBe('fix the bug');
    // Capitalised 'Text' part on AgentMessage — commentary renders like the
    // legacy agent_message narration did.
    expect(result.messages[1]?.text).toBe('Checking the branch first.');
    expect(result.messages[2]?.text).toBe('Done — the bug is fixed.');
    expect(result.messages.some((m) => m.text.includes('injected AGENTS.md'))).toBe(false);
    // Reasoning items stay internal.
    expect(result.messages.some((m) => m.text.includes('chain of thought'))).toBe(false);
  });

  it('builds the work log from response_item only, so a CommandExecution item does not duplicate the row', async () => {
    const result = await parseCodexConversationMessages(file);

    const shell = result.workLog.filter((w) => w.command === 'git status');
    expect(shell).toHaveLength(1);
    expect(shell[0]?.result).toContain('clean');
    expect(result.workLog).toHaveLength(1);
  });

  it('still reports cumulative tokens and non-zero cost on the new shape', async () => {
    const result = await parseCodexConversationMessages(file);

    expect(result.totalTokens).toBe(60700);
    expect(result.totalCost).toBeGreaterThan(0);
  });
});
