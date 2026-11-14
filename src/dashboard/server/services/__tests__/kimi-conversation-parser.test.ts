import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseKimiConversationMessages } from '../kimi-conversation-parser.js';

const FIXTURE_PATH = join(
  import.meta.dirname,
  '..', '..', '..', '..', '..',
  'tests', 'fixtures', 'kimi', 'wire.jsonl',
);

describe('parseKimiConversationMessages (PAN-1837 wi8b AC4, against the pinned wi-fixture)', () => {
  it('extracts user and assistant turns from turn.prompt / content.part text, skipping think parts', async () => {
    const result = await parseKimiConversationMessages(FIXTURE_PATH);

    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(result.messages[0]?.text).toBe('Read the file sample.txt in this directory using your file read tool and tell me what it says.');
    expect(result.messages[1]?.text).toBe('The file `sample.txt` contains a single line:\n\n```\nhello world\n```');
    expect(result.messages[2]?.text).toBe("Now create a file named result.txt containing the word 'done', using your file write tool, then confirm.");
    expect(result.messages[3]?.text).toBe('Created `result.txt` containing the word "done" (5 bytes, including a trailing newline).');
    // Hidden reasoning ('think' content.part events) must never surface as a message.
    expect(result.messages.every((m) => m.text.trim().length > 0)).toBe(true);
  });

  it('pairs each tool.call with its tool.result into one work-log entry (AC4 — tool calls appear)', async () => {
    const result = await parseKimiConversationMessages(FIXTURE_PATH);

    expect(result.workLog).toHaveLength(2);
    expect(result.workLog[0]).toMatchObject({
      label: 'Read',
      tone: 'tool',
      toolInput: { path: 'sample.txt' },
      result: '1\thello world',
    });
    expect(result.workLog[1]).toMatchObject({
      label: 'Write',
      tone: 'tool',
      toolInput: { path: 'result.txt', content: 'done\n' },
      result: 'Wrote 5 bytes to result.txt',
    });
  });

  it('reports the same non-zero cost/token totals as the canonical kimi-parser (single source of truth)', async () => {
    const result = await parseKimiConversationMessages(FIXTURE_PATH);

    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('sets lastTurnCompletedAt to the final assistant reply and reports byteOffset/mtimeMs', async () => {
    const result = await parseKimiConversationMessages(FIXTURE_PATH);

    expect(result.lastTurnCompletedAt).toBe(result.messages[result.messages.length - 1]?.completedAt);
    expect(result.streaming).toBe(false);
    expect(result.byteOffset).toBeGreaterThan(0);
    expect(result.mtimeMs).toBeGreaterThan(0);
  });
});

/** PAN-5211: kimi stringifies non-string results, so image data URLs must become placeholders. */
describe('parseKimiConversationMessages — bounded tool results', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kimi-bounds-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('stores a result object holding a PNG data URL with a placeholder', async () => {
    const file = join(dir, 'wire.jsonl');
    const image = `data:image/png;base64,${Buffer.alloc(200_000, 5).toString('base64')}`;
    const events = [
      { type: 'tool.call', uuid: 'tool_1', turnId: '0', toolCallId: 'tool_1', name: 'Screenshot', args: {} },
      { type: 'tool.result', toolCallId: 'tool_1', result: { content: [{ type: 'image', url: image }], note: 'captured' } },
    ];
    await writeFile(file, events.map((event, i) => JSON.stringify({ type: 'context.append_loop_event', event, time: 1785265211159 + i })).join('\n') + '\n');

    const result = await parseKimiConversationMessages(file);

    const stored = result.workLog.find((e) => e.id === 'tool_1')?.result ?? '';
    expect(stored).toContain('[image: png, ');
    expect(stored).toContain('captured');
    expect(stored).not.toContain('data:image');
  });
});
