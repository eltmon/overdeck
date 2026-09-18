import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexConversationAccumulator } from '../codex-conversation-parser.js';
import { createIncrementalTranscriptReader } from '../incremental-transcript-reader.js';
import { parseCodexSessionSync } from '../../../../lib/cost-parsers/codex-parser.js';

const line = (type: string, payload: object) => JSON.stringify({ type, timestamp: '2026-09-09T00:00:00Z', payload }) + '\n';
const message = (text: string) => line('event_msg', { type: 'user_message', message: text });
let dir: string;
let file: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'incremental-codex-')); file = join(dir, 'rollout.jsonl'); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('incremental Codex history', () => {
  it('decodes only appended records, coalesces readers, and preserves earlier tool snapshots and costs', async () => {
    const push = vi.fn();
    const read = createIncrementalTranscriptReader((path) => {
      const parser = createCodexConversationAccumulator(path);
      return { ...parser, push: (text) => { push(text); parser.push(text); } };
    });
    const initial = line('turn_context', { model: 'gpt-5.5' }) + message('First') +
      line('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"pwd"}', call_id: 'tool' });
    await writeFile(file, initial);
    const firstJob = read(file);
    expect(read(file)).toBe(firstJob);
    const first = await firstJob;
    expect(push).toHaveBeenCalledTimes(3);
    expect(await read(file)).toBe(first);
    expect(push).toHaveBeenCalledTimes(3);
    await appendFile(file, line('response_item', { type: 'function_call_output', call_id: 'tool', output: 'the full result' }) +
      line('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 100, total_tokens: 1100 } } }));
    const next = await read(file);
    expect(push).toHaveBeenCalledTimes(5);
    expect(next.messages).toEqual(first.messages);
    expect(next.workLog).toEqual([{ ...first.workLog[0], result: 'the full result' }]);
    expect(first.workLog[0].result).toBeUndefined();
    expect(next.totalTokens).toBe(1100);
    expect(next.totalCost).toBeGreaterThan(0);
    expect(next.totalCost).toBe(parseCodexSessionSync(file)?.cost_v2);
    expect(next.transcriptGeneration).toBe(first.transcriptGeneration);
  });

  it('holds incomplete JSON and split UTF-8 until complete, without losing later records', async () => {
    const read = createIncrementalTranscriptReader(createCodexConversationAccumulator);
    const bytes = Buffer.from(message('hello 🌍'));
    const split = bytes.indexOf(Buffer.from('🌍')) + 2;
    await writeFile(file, bytes.subarray(0, split));
    expect((await read(file)).messages).toEqual([]);
    await appendFile(file, bytes.subarray(split));
    expect((await read(file)).messages.map(m => m.text)).toEqual(['hello 🌍']);
    await appendFile(file, message('No final newline').trimEnd());
    expect((await read(file)).messages.map(m => m.text)).toEqual(['hello 🌍', 'No final newline']);
    await appendFile(file, '\n' + message('Next'));
    expect((await read(file)).messages.map(m => m.text)).toEqual(['hello 🌍', 'No final newline', 'Next']);
  });

  it.each(['truncate', 'same-size', 'grow', 'replace'] as const)('rebuilds after a %s rewrite', async (kind) => {
    const read = createIncrementalTranscriptReader(createCodexConversationAccumulator);
    await writeFile(file, message('Old message'));
    const first = await read(file);
    const updated = message(kind === 'same-size' ? 'New message' : kind === 'truncate' ? 'New' : 'A longer replacement message');
    if (kind === 'replace') {
      await writeFile(join(dir, 'replacement'), updated);
      await rename(join(dir, 'replacement'), file);
    } else await writeFile(file, updated);
    const next = await read(file);
    expect(next.messages.map(m => m.text)).toEqual([JSON.parse(updated).payload.message]);
    expect(next.transcriptGeneration).not.toBe(first.transcriptGeneration);
    expect(next.lastSequence).toBe(1);
  });

  it('retains every history row beyond the read chunk and safely evicts cold files', async () => {
    const create = vi.fn(createCodexConversationAccumulator);
    const read = createIncrementalTranscriptReader(create);
    await writeFile(file, message('x'.repeat(1024 * 1024)) + message('Last'));
    const first = await read(file);
    expect(first.messages).toHaveLength(2);
    expect(first.messages[0].text).toHaveLength(1024 * 1024);
    for (let i = 0; i < 8; i++) {
      const other = join(dir, `${i}.jsonl`);
      await writeFile(other, message(String(i)));
      await read(other);
    }
    expect((await read(file)).messages).toEqual(first.messages);
    expect(create).toHaveBeenCalledTimes(10);
  });
});
