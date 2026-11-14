/**
 * PAN-5211 NFR-1/NFR-2: a cold open of a 200 MB Codex transcript full of base64 screenshots stays
 * bounded in time, peak RSS and retained heap.
 *
 * These measure heap, RSS and time rather than result size alone, because a size check cannot see a
 * sliced string that keeps its parent alive.
 */
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCodexSessionParser } from '../../../../lib/cost-parsers/codex-parser.js';
import { CODEX_TAIL_CONTEXT_MARKER, createCodexConversationAccumulator } from '../codex-conversation-parser.js';
import { createIncrementalTranscriptReader } from '../incremental-transcript-reader.js';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

const MiB = 1024 * 1024;
const PAIRS = 170;
const TEXT_CHARS = 20_000;
const IMAGE_BASE64_BYTES = 1_200_000;

let dir: string;
let file: string;
let finalTotalTokens = 0;
/** The two records whole-file pricing depends on: the model and the last cumulative usage. */
let turnContextLine = '';
let finalTokenCountLine = '';

/** Stream the rollout to disk so generation never holds more than one shared payload. */
async function writeRollout(path: string): Promise<void> {
  const out = createWriteStream(path);
  const write = async (chunk: string | Buffer): Promise<void> => {
    if (!out.write(chunk)) await once(out, 'drain');
  };
  const payload = Buffer.from('A'.repeat(IMAGE_BASE64_BYTES), 'latin1');
  const text = 't'.repeat(TEXT_CHARS);
  const timestamp = '2026-11-10T12:00:00.000Z';
  turnContextLine = JSON.stringify({ timestamp, type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-5.5' } });
  await write(`${turnContextLine}\n`);
  for (let i = 0; i < PAIRS; i++) {
    const callId = `call_${i}`;
    await write(`${JSON.stringify({ timestamp, type: 'response_item', payload: { type: 'custom_tool_call', name: 'screenshot', input: 'take', call_id: callId } })}\n`);
    // A distinct per-index base64 prefix keeps every image unique without mutating the shared payload.
    const prefix = `{"timestamp":"${timestamp}","type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"${callId}",`
      + `"output":[{"type":"input_text","text":"${text}"},{"type":"input_image","image_url":"data:image/png;base64,${String(i).padStart(8, '0')}`;
    await write(prefix);
    await write(payload);
    await write('","detail":"high"}]}}\n');
    if ((i + 1) % 10 === 0) {
      finalTotalTokens = (i + 1) * 1000;
      finalTokenCountLine = JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: finalTotalTokens - 100, output_tokens: 100, total_tokens: finalTotalTokens } } } });
      await write(`${finalTokenCountLine}\n`);
    }
  }
  out.end();
  await once(out, 'finish');
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pan-5211-'));
  file = join(dir, 'rollout-2026-11-10T12-00-00-memory.jsonl');
  await writeRollout(file);
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Codex transcript memory bounds (PAN-5211)', () => {
  it('opens a 200 MB screenshot transcript cold within the time, RSS and heap bounds', async () => {
    expect((await stat(file)).size).toBeGreaterThanOrEqual(200_000_000);
    gc(); gc();
    const heapBefore = v8.getHeapStatistics().used_heap_size;
    const rssBefore = process.memoryUsage().rss;
    const t0 = performance.now();

    const result = await createIncrementalTranscriptReader(createCodexConversationAccumulator, { tailContextMarker: CODEX_TAIL_CONTEXT_MARKER })(file);

    const elapsed = performance.now() - t0;
    const peakRssGrowth = process.resourceUsage().maxRSS * 1024 - rssBefore;
    gc(); gc();
    const heapGrowth = v8.getHeapStatistics().used_heap_size - heapBefore;

    expect(elapsed).toBeLessThan(5_000);
    expect(peakRssGrowth).toBeLessThan(256 * MiB);
    expect(heapGrowth).toBeLessThan(64 * MiB);
    expect(result.workLog.length).toBeGreaterThan(0);
    for (const entry of result.workLog) {
      expect(entry.result ?? '').not.toContain('data:image');
      expect((entry.result ?? '').length).toBeLessThanOrEqual(65_536 + 100);
    }
    expect(result.historyStartOffset).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(finalTotalTokens);
    // The only turn_context is at byte 0, far outside the tail; the cost still uses its model.
    const whole = createCodexSessionParser(file);
    whole.push(turnContextLine);
    whole.push(finalTokenCountLine);
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.totalCost).toBe(whole.result()?.cost_v2);
  }, 60_000);

  it('keeps a capped window under its retained-character limit', async () => {
    let accumulator: ReturnType<typeof createCodexConversationAccumulator> | undefined;
    const read = createIncrementalTranscriptReader((path, options) => {
      accumulator = createCodexConversationAccumulator(path, { ...options, maxRetainedChars: 1_000_000, windowTargetChars: 750_000 });
      return accumulator;
    });
    gc(); gc();
    const heapBefore = v8.getHeapStatistics().used_heap_size;

    const result = await read(file);

    gc(); gc();
    const heapGrowth = v8.getHeapStatistics().used_heap_size - heapBefore;
    expect(result.workLog.length).toBeGreaterThan(0);
    expect(accumulator!.retainedChars()).toBeLessThanOrEqual(1_000_000);
    expect(heapGrowth).toBeLessThan(16 * MiB);
  }, 60_000);
});
