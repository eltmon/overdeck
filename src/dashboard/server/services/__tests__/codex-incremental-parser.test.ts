import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_TAIL_CONTEXT_MARKER, createCodexConversationAccumulator } from '../codex-conversation-parser.js';
import { createIncrementalTranscriptReader, type Accumulator } from '../incremental-transcript-reader.js';
import type { ParseResult, RecordLocation } from '../conversation/types.js';
import { estimateParseResultChars } from '../conversation/tool-result-bounds.js';
import { parseCodexSession } from '../../../../lib/cost-parsers/codex-parser.js';

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
    expect(next.totalCost).toBe(parseCodexSession(file)?.cost_v2);
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
    // PAN-5211: the only row comes from the record at byte 0.
    expect(next.lastSequence).toBe(0);
    expect(next.messages[0]!.sequence).toBe(0);
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

  it('passes each pushed line its exact byte location, across a chunk boundary and after an append', async () => {
    const pushed: Array<{ text: string; location?: RecordLocation }> = [];
    const read = createIncrementalTranscriptReader((path) => {
      const parser = createCodexConversationAccumulator(path);
      return { ...parser, push: (text, location) => { pushed.push({ text, location }); parser.push(text); } };
    });
    // The first message straddles the 1 MiB read-chunk boundary; the 🌍 makes byte and char offsets differ.
    await writeFile(file, message('🌍 head') + message('y'.repeat(1024 * 1024 - 40)) + message('after boundary 🌍'));
    await read(file);
    await appendFile(file, message('appended 🌍') + message('last'));
    await read(file);

    const bytes = await readFile(file);
    expect(pushed).toHaveLength(5);
    let expectedOffset = 0;
    for (const { text, location } of pushed) {
      expect(location).toBeDefined();
      expect(location!.offset).toBe(expectedOffset);
      expect(bytes.subarray(location!.offset, location!.offset + location!.length).toString('utf8')).toBe(text);
      expectedOffset += location!.length + 1;
    }
    expect(expectedOffset).toBe(bytes.length);
  });

  it('keeps offsets exact when a record without a final newline is closed by a later append', async () => {
    const pushed: Array<{ text: string; location?: RecordLocation }> = [];
    const read = createIncrementalTranscriptReader((path) => {
      const parser = createCodexConversationAccumulator(path);
      return { ...parser, push: (text, location) => { pushed.push({ text, location }); parser.push(text); } };
    });
    await writeFile(file, message('first') + message('no newline').trimEnd());
    await read(file);
    await appendFile(file, '\n' + message('next'));
    const result = await read(file);

    const bytes = await readFile(file);
    expect(result.messages.map(m => m.text)).toEqual(['first', 'no newline', 'next']);
    expect(pushed).toHaveLength(3);
    for (const { text, location } of pushed) {
      expect(bytes.subarray(location!.offset, location!.offset + location!.length).toString('utf8')).toBe(text);
    }
  });

  it('pushes a line holding an image data URL already scrubbed', async () => {
    const pushed: string[] = [];
    const read = createIncrementalTranscriptReader((path) => {
      const parser = createCodexConversationAccumulator(path);
      return { ...parser, push: (text) => { pushed.push(text); parser.push(text); } };
    });
    const image = `data:image/png;base64,${Buffer.alloc(30_000, 1).toString('base64')}`;
    await writeFile(file, line('response_item', {
      type: 'custom_tool_call_output', call_id: 'c1',
      output: [{ type: 'input_text', text: 'shot' }, { type: 'input_image', image_url: image, detail: 'high' }],
    }));
    await read(file);

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toContain('[image: png, ');
    expect(pushed[0]).not.toContain('data:image');
  });

  it('sends a line over recordParseMaxBytes to pushOversized, not push', async () => {
    const push = vi.fn();
    const pushOversized = vi.fn();
    const read = createIncrementalTranscriptReader((path): Accumulator => {
      const parser = createCodexConversationAccumulator(path);
      return { ...parser, push: (text) => { push(text); parser.push(text); }, pushOversized };
    }, { recordParseMaxBytes: 1024 });
    const big = message('z'.repeat(4096));
    await writeFile(file, message('small') + big);
    await read(file);

    expect(push).toHaveBeenCalledTimes(1);
    expect(pushOversized).toHaveBeenCalledTimes(1);
    const [head, location] = pushOversized.mock.calls[0] as [string, RecordLocation];
    expect(location).toEqual({ offset: Buffer.byteLength(message('small')), length: Buffer.byteLength(big) - 1 });
    expect(head.length).toBeLessThanOrEqual(4096);
    expect(big.startsWith(head)).toBe(true);
  });

  it('evicts the oldest file by summed retained characters and re-parses it from byte 0', async () => {
    const pushes: Array<{ path: string; offset?: number }> = [];
    const read = createIncrementalTranscriptReader((path) => {
      const parser = createCodexConversationAccumulator(path);
      return { ...parser, push: (text, location) => { pushes.push({ path, offset: location?.offset }); parser.push(text); } };
    }, { maxCacheRetainedChars: 2_500 });
    const files = ['a', 'b', 'c'].map((name) => join(dir, `${name}.jsonl`));
    for (const path of files) await writeFile(path, message('m'.repeat(1_000)));
    for (const path of files) await read(path);

    pushes.length = 0;
    await read(files[2]!);
    await read(files[1]!);
    expect(pushes).toEqual([]);
    await read(files[0]!);
    expect(pushes).toEqual([{ path: files[0], offset: 0 }]);
  });

  it('returns an entry over the hard cap without caching it', async () => {
    const create = vi.fn((path: string): Accumulator => {
      const parser = createCodexConversationAccumulator(path);
      return { ...parser, retainedChars: () => 1_000_000 };
    });
    const read = createIncrementalTranscriptReader(create, { maxEntryRetainedChars: 10_000 });
    await writeFile(file, message('kept'));

    const first = await read(file);
    const second = await read(file);

    expect(first.messages.map(m => m.text)).toEqual(['kept']);
    expect(second.messages.map(m => m.text)).toEqual(['kept']);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('reports retainedChars equal to the estimate of its result', () => {
    const parser = createCodexConversationAccumulator(file);
    for (const text of [message('hello'), message('world')]) parser.push(text.trimEnd());
    parser.push(line('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls -la"}', call_id: 'c1' }).trimEnd());
    parser.push(line('response_item', { type: 'function_call_output', call_id: 'c1', output: 'total 0' }).trimEnd());
    parser.push(line('response_item', { type: 'custom_tool_call_output', call_id: 'orphan', output: 'stray' }).trimEnd());

    const result: ParseResult = parser.result(0, 0);
    expect(result.workLog).toHaveLength(2);
    expect(parser.retainedChars()).toBe(estimateParseResultChars(result));
  });

  it('opens a transcript over tailReadBytes by reading only its tail, keeping the cumulative totals', async () => {
    const tokenCount = (total: number) => line('event_msg', {
      type: 'token_count', info: { total_token_usage: { input_tokens: total - 10, output_tokens: 10, total_tokens: total } },
    });
    let body = line('turn_context', { model: 'gpt-5.5' });
    let total = 0;
    for (let i = 0; Buffer.byteLength(body) < 1_000_000; i++) {
      body += message(`message ${i} ${'p'.repeat(200)}`);
      if (i % 20 === 0) body += tokenCount((total += 1000));
    }
    body += tokenCount((total += 1000));
    await writeFile(file, body);
    const size = Buffer.byteLength(body);

    const offsets: number[] = [];
    const read = createIncrementalTranscriptReader((path, options) => {
      const parser = createCodexConversationAccumulator(path, options);
      return { ...parser, push: (text, location) => { if (location) offsets.push(location.offset); parser.push(text); } };
    }, { tailReadBytes: 64 * 1024, tailContextMarker: CODEX_TAIL_CONTEXT_MARKER });
    const result = await read(file);

    // The only turn_context is at byte 0, outside the tail; cost still uses its model.
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.totalCost).toBe(parseCodexSession(file)?.cost_v2);
    expect(offsets.length).toBeGreaterThan(0);
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(size - 65_536);
    expect(result.historyStartOffset).toBe(Math.min(...offsets));
    expect(result.historyStartOffset).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(total);

    offsets.length = 0;
    await appendFile(file, message('appended one') + message('appended two'));
    const next = await read(file);
    expect(offsets).toEqual([size, size + Buffer.byteLength(message('appended one'))]);
    expect(next.messages.slice(-2).map(m => m.text)).toEqual(['appended one', 'appended two']);
  });

  it('numbers reader-fed rows by record offset, from byte 0 and after a tail read', async () => {
    let body = '';
    for (let i = 0; i < 400; i++) {
      body += message(`user ${i} ${'u'.repeat(100)}`);
      body += line('event_msg', { type: 'agent_message', message: `agent ${i}` });
    }
    await writeFile(file, body);
    const bytes = await readFile(file);
    const lineAt = (offset: number) => bytes.subarray(offset, bytes.indexOf(10, offset)).toString('utf8');

    for (const options of [{}, { tailReadBytes: 8 * 1024 }]) {
      const result = await createIncrementalTranscriptReader(createCodexConversationAccumulator, options)(file);
      expect(result.messages.length).toBeGreaterThan(0);
      for (const m of result.messages) {
        const record = JSON.parse(lineAt(m.sequence!)) as { payload: { type: string; message: string } };
        expect(record.payload.message).toBe(m.text);
        expect(m.id).toBe(`codex-${record.payload.type === 'user_message' ? 'user' : 'agent'}-@${m.sequence}`);
      }
      expect(result.lastSequence).toBe(result.messages[result.messages.length - 1]!.sequence);
    }
  });

  it('reports each message row through onRowCreated as legacy id and offset id', () => {
    const created: Array<[string, string]> = [];
    const parser = createCodexConversationAccumulator(file, { onRowCreated: (legacyId, id) => created.push([legacyId, id]) });
    const call = line('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls"}', call_id: 'c1' }).trimEnd();
    parser.push(call, { offset: 0, length: Buffer.byteLength(call) });
    const user = message('hello').trimEnd();
    const userOffset = Buffer.byteLength(call) + 1;
    parser.push(user, { offset: userOffset, length: Buffer.byteLength(user) });

    expect(created).toEqual([['codex-user-2', `codex-user-@${userOffset}`]]);
  });

  it('records each output\'s byte location so it slices exactly that line', async () => {
    await writeFile(file, message('go') +
      line('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"pwd"}', call_id: 'c1' }) +
      line('response_item', { type: 'function_call_output', call_id: 'c1', output: '/repo' }) +
      line('response_item', { type: 'custom_tool_call_output', call_id: 'orphan', output: 'stray' }));
    const result = await createIncrementalTranscriptReader(createCodexConversationAccumulator)(file);
    const bytes = await readFile(file);

    // A stand-alone output row's id is its record offset; its record still carries the call_id.
    const orphanRow = result.workLog.find((w) => w.label === 'Tool result')!;
    expect(orphanRow.id).toBe(`codex-tool-out-@${orphanRow.sequence}`);
    for (const [rowId, callId] of [['c1', 'c1'], [orphanRow.id, 'orphan']] as const) {
      const location = result.toolResultLocations?.get(rowId);
      expect(location).toBeDefined();
      const record = JSON.parse(bytes.subarray(location!.offset, location!.offset + location!.length).toString('utf8')) as {
        payload: { call_id: string; type: string };
      };
      expect(record.payload.call_id).toBe(callId);
      expect(record.payload.type).toMatch(/_output$/);
    }
  });

  it('keeps counter ids for direct pushes without a location', () => {
    const parser = createCodexConversationAccumulator(file);
    parser.push(message('one').trimEnd());
    parser.push(line('response_item', { type: 'function_call', name: 'x', arguments: '', call_id: '' }).trimEnd());
    parser.push(message('two').trimEnd());

    const result = parser.result(0, 0);
    expect(result.messages.map(m => [m.id, m.sequence])).toEqual([['codex-user-1', 1], ['codex-user-3', 3]]);
    expect(result.workLog.map(w => [w.id, w.sequence])).toEqual([['codex-tool-2', 2]]);
    expect(result.lastSequence).toBe(3);
  });

  it('stores an oversized output for a known call as an omitted body with its location', async () => {
    const call = line('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"cat big"}', call_id: 'c-big' });
    const output = line('response_item', { type: 'function_call_output', call_id: 'c-big', output: 'b'.repeat(10_000) });
    await writeFile(file, call + output);
    const result = await createIncrementalTranscriptReader(createCodexConversationAccumulator, { recordParseMaxBytes: 2048 })(file);

    const entry = result.workLog.find((w) => w.id === 'c-big');
    expect(entry).toMatchObject({ bodyOmitted: true, resultBytes: Buffer.byteLength(output) - 1 });
    expect(entry).not.toHaveProperty('result');
    expect(result.toolResultLocations?.get('c-big')).toEqual({ offset: Buffer.byteLength(call), length: Buffer.byteLength(output) - 1 });
  });

  it('adds a skipped row for an oversized record it cannot attach', async () => {
    const small = message('before');
    const big = line('response_item', { type: 'something_new', blob: 'k'.repeat(10_000) });
    await writeFile(file, small + big);
    const result = await createIncrementalTranscriptReader(createCodexConversationAccumulator, { recordParseMaxBytes: 2048 })(file);

    const offset = Buffer.byteLength(small);
    expect(result.workLog).toEqual([{
      id: `codex-skipped-${offset}`,
      createdAt: '2026-09-09T00:00:00Z',
      label: 'Skipped a 0.0 MB transcript record',
      tone: 'info',
      sequence: offset,
    }]);
  });
});
