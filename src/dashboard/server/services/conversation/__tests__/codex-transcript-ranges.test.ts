import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkLogEntry } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withFullToolResult } from '../codex-transcript-ranges.js';
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
