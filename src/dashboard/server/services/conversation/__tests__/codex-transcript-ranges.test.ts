import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkLogEntry } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decodeTimelineCursor } from '@overdeck/contracts';

import { createCodexConversationAccumulator } from '../../codex-conversation-parser.js';
import { createIncrementalTranscriptReader } from '../../incremental-transcript-reader.js';
import {
  findCodexToolEntryFrom,
  readCodexRowsBefore,
  resolveToolBodyEntry,
  selectHistoryPageBefore,
  withFullToolResult,
} from '../codex-transcript-ranges.js';
import { selectInitialWindow, selectPageBefore } from '../window.js';
import { RECORD_FULL_READ_MAX_BYTES } from '../tool-result-bounds.js';
import type { RecordLocation } from '../types.js';

let dir: string;
let file: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'codex-ranges-')); file = join(dir, 'rollout.jsonl'); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const record = (payload: object) => JSON.stringify({ type: 'response_item', timestamp: '2026-11-13T00:00:00.000Z', payload });
const stored: WorkLogEntry = { id: 'call_1', createdAt: '2026-11-13T00:00:00.000Z', label: 'Shell', tone: 'tool', result: 'cut', sequence: 0 };

/** Write the lines and return each line's location. */
async function writeLines(lines: string[]): Promise<RecordLocation[]> {
  await writeFile(file, lines.join('\n') + '\n');
  const locations: RecordLocation[] = [];
  let offset = 0;
  for (const text of lines) {
    locations.push({ offset, length: Buffer.byteLength(text) });
    offset += Buffer.byteLength(text) + 1;
  }
  return locations;
}

describe('withFullToolResult (PAN-5211)', () => {
  it('returns the full output text with image placeholders', async () => {
    const text = 'f'.repeat(100_000);
    const image = `data:image/png;base64,${Buffer.alloc(300_000, 9).toString('base64')}`;
    const [, output] = await writeLines([
      record({ type: 'custom_tool_call', name: 'screenshot', input: 'x', call_id: 'call_1' }),
      record({ type: 'custom_tool_call_output', call_id: 'call_1', output: [
        { type: 'input_text', text },
        { type: 'input_image', image_url: image, detail: 'high' },
      ] }),
    ]);

    const entry = await withFullToolResult(file, new Map([['call_1', output!]]), stored);

    expect(entry.result).toContain(text);
    expect(entry.result).toContain('[image: png, ');
    expect(entry.result).not.toContain('data:image');
  });

  it('returns the stored entry when the location points at another call_id', async () => {
    const [, other] = await writeLines([
      record({ type: 'function_call', name: 'exec_command', arguments: '{}', call_id: 'call_1' }),
      record({ type: 'function_call_output', call_id: 'call_2', output: 'not mine' }),
    ]);

    expect(await withFullToolResult(file, new Map([['call_1', other!]]), stored)).toBe(stored);
  });

  it('returns the stored entry when the file is missing', async () => {
    expect(await withFullToolResult(join(dir, 'missing.jsonl'), new Map([['call_1', { offset: 0, length: 10 }]]), stored)).toBe(stored);
  });

  it('returns the stored entry for a location longer than the full-read limit', async () => {
    await writeLines([record({ type: 'function_call_output', call_id: 'call_1', output: 'x' })]);
    const tooLong = { offset: 0, length: RECORD_FULL_READ_MAX_BYTES + 1 };

    expect(await withFullToolResult(file, new Map([['call_1', tooLong]]), stored)).toBe(stored);
  });
});

describe('selectHistoryPageBefore (PAN-5211)', () => {
  const userLine = (i: number) => JSON.stringify({
    type: 'event_msg',
    timestamp: new Date(Date.UTC(2026, 10, 13) + i * 1000).toISOString(),
    payload: { type: 'user_message', message: `message ${String(i).padStart(3, '0')} ${'m'.repeat(200)}` },
  });

  it('walks back through every older message from disk, once each and in order', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => userLine(i));
    await writeLines(lines);
    const lineBytes = Buffer.byteLength(lines[0]!) + 1;
    // Memory holds about 50 messages; each disk step covers about 10.
    const parsed = await createIncrementalTranscriptReader(createCodexConversationAccumulator, { tailReadBytes: 50 * lineBytes })(file);
    expect(parsed.historyStartOffset).toBeGreaterThan(0);
    expect(parsed.messages.length).toBeLessThan(60);
    const options = { stepBytes: 10 * lineBytes, maxBytes: 64 * lineBytes };

    const initial = selectInitialWindow(parsed);
    expect(initial.window).toMatchObject({ hasOlder: true, bounded: true });
    const seen = [...initial.messages];
    let cursor = initial.window.cursor;
    let lastPage = initial;
    for (let guard = 0; guard < 200 && lastPage.window.hasOlder; guard++) {
      lastPage = await selectHistoryPageBefore(parsed, file, decodeTimelineCursor(cursor!)!, 20, undefined, options);
      expect(lastPage.window.bounded).toBe(true);
      seen.unshift(...lastPage.messages);
      cursor = lastPage.window.cursor;
    }

    expect(lastPage.window.hasOlder).toBe(false);
    expect(seen.map((m) => m.text.slice(0, 11))).toEqual(lines.map((_, i) => `message ${String(i).padStart(3, '0')}`));
    expect(new Set(seen.map((m) => m.id)).size).toBe(300);
  });

  it('returns the in-memory page unchanged for a conversation that is not bounded', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => userLine(i));
    await writeLines(lines);
    const parsed = await createIncrementalTranscriptReader(createCodexConversationAccumulator)(file);
    const before = decodeTimelineCursor(selectInitialWindow(parsed, undefined, { maxRows: 10, maxBytes: 1024 * 1024 }).window.cursor!)!;

    const page = await selectHistoryPageBefore(parsed, file, before, 5);

    expect(page).toEqual(selectPageBefore(parsed, before, 5));
    expect(page.window).not.toHaveProperty('bounded');
  });
});

describe('resolveToolBodyEntry for a row from a disk page (PAN-5211)', () => {
  async function boundedTranscript() {
    const output = 'z'.repeat(100_000);
    const lines = [
      record({ type: 'function_call', name: 'exec_command', arguments: '{"cmd":"cat big"}', call_id: 'call_old' }),
      record({ type: 'function_call_output', call_id: 'call_old', output }),
      ...Array.from({ length: 200 }, (_, i) => JSON.stringify({
        type: 'event_msg', timestamp: '2026-11-13T00:00:01.000Z', payload: { type: 'user_message', message: `later ${i} ${'l'.repeat(200)}` },
      })),
    ];
    const [call] = await writeLines(lines);
    const parsed = await createIncrementalTranscriptReader(createCodexConversationAccumulator, { tailReadBytes: 16 * 1024 })(file);
    return { parsed, callOffset: call!.offset, output };
  }

  it('finds an evicted tool row from its call offset and serves its full output', async () => {
    const { parsed, callOffset, output } = await boundedTranscript();
    expect(parsed.workLog.find((w) => w.id === 'call_old')).toBeUndefined();
    expect(parsed.historyStartOffset).toBeGreaterThan(callOffset);

    const entry = await resolveToolBodyEntry(file, parsed, 'call_old', callOffset);

    expect(entry?.id).toBe('call_old');
    expect(entry?.result).toBe(output);
  });

  it('returns undefined without seq or for a seq that is not a line start', async () => {
    const { parsed, callOffset } = await boundedTranscript();

    expect(await resolveToolBodyEntry(file, parsed, 'call_old')).toBeUndefined();
    expect(await resolveToolBodyEntry(file, parsed, 'call_old', callOffset + 1)).toBeUndefined();
  });
});

describe('disk-page edge cases (PAN-5211 review)', () => {
  const userEvent = (i: number) => JSON.stringify({
    type: 'event_msg', timestamp: '2026-11-13T00:00:01.000Z', payload: { type: 'user_message', message: `m${i} ${'u'.repeat(100)}` },
  });

  it('finds an output in a final record that has no newline yet', async () => {
    const call = record({ type: 'function_call', name: 'exec_command', arguments: '{}', call_id: 'call_tail' });
    const output = record({ type: 'function_call_output', call_id: 'call_tail', output: 'tail output' });
    await writeFile(file, `${call}\n${output}`);

    const entry = await findCodexToolEntryFrom(file, 0, 'call_tail');

    expect(entry?.result).toBe('tail output');
  });

  it('skips a record longer than the scan limit so paging moves past it', async () => {
    const huge = record({ type: 'function_call_output', call_id: 'huge', output: 'h'.repeat(20_000) });
    const [, hugeAt, after] = await writeLines([userEvent(0), huge, userEvent(2)]);

    const skipped = await readCodexRowsBefore(file, after!.offset, 5, { stepBytes: 1024, maxBytes: 4096 });
    expect(skipped).toEqual({ messages: [], workLog: [], rangeStart: hugeAt!.offset });

    const earlier = await readCodexRowsBefore(file, skipped.rangeStart, 5, { stepBytes: 1024, maxBytes: 4096 });
    expect(earlier.messages.map((m) => m.text.slice(0, 2))).toEqual(['m0']);
    expect(earlier.rangeStart).toBe(0);
  });

  it('reports where the kept rows begin when a range drops its oldest rows', async () => {
    const locations = await writeLines(Array.from({ length: 40 }, (_, i) => userEvent(i)));
    const end = locations[39]!.offset;

    const rows = await readCodexRowsBefore(file, end, 5, { maxRetainedChars: 1_000, windowTargetChars: 800 });

    expect(rows.rangeStart).toBeGreaterThan(0);
    expect(rows.rangeStart).toBe(rows.messages[0]!.sequence);
  });

  it('marks a disk-page call without its output as an omitted body', async () => {
    const lines = [
      record({ type: 'function_call', name: 'exec_command', arguments: '{"cmd":"sleep"}', call_id: 'call_open' }),
      ...Array.from({ length: 60 }, (_, i) => userEvent(i)),
      record({ type: 'function_call_output', call_id: 'call_open', output: 'finally' }),
    ];
    const [call] = await writeLines(lines);
    const lineBytes = Buffer.byteLength(lines[1]!) + 1;
    const parsed = await createIncrementalTranscriptReader(createCodexConversationAccumulator, { tailReadBytes: 20 * lineBytes })(file);
    const before = decodeTimelineCursor(selectInitialWindow(parsed).window.cursor!)!;

    let page = await selectHistoryPageBefore(parsed, file, before, 200);
    for (let guard = 0; guard < 20 && !page.workLog.some((w) => w.id === 'call_open') && page.window.hasOlder; guard++) {
      page = await selectHistoryPageBefore(parsed, file, decodeTimelineCursor(page.window.cursor!)!, 200);
    }

    const row = page.workLog.find((w) => w.id === 'call_open');
    expect(row).toMatchObject({ bodyOmitted: true, sequence: call!.offset });
    expect((await resolveToolBodyEntry(file, parsed, 'call_open', row!.sequence))?.result).toBe('finally');
    // The in-memory stand-alone output keeps its own id, so the call row above is not deduplicated away.
    const standAlone = parsed.workLog.find((w) => w.label === 'Tool result')!;
    expect(standAlone.id).toMatch(/^codex-tool-out-@\d+$/);
    expect((await resolveToolBodyEntry(file, parsed, standAlone.id))?.result).toBe('finally');
  });
});

