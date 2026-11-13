import type { ChatMessage, WorkLogEntry } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import {
  boundToolResultText,
  estimateMessageChars,
  estimateParseResultChars,
  estimateWorkLogEntryChars,
  imagePlaceholder,
  ROW_OVERHEAD_CHARS,
} from '../tool-result-bounds.js';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function base64Of(bytes: number): string {
  return Buffer.alloc(bytes, 7).toString('base64');
}

describe('imagePlaceholder', () => {
  it('reports the decoded size in KiB, at least 1', () => {
    expect(imagePlaceholder('png', 412 * 1024)).toBe('[image: png, 412 KB]');
    expect(imagePlaceholder('jpeg', 10)).toBe('[image: jpeg, 1 KB]');
  });
});

describe('boundToolResultText', () => {
  it('replaces a 1 MB PNG data URL in a stringified Codex output array with a placeholder', () => {
    const decoded = 1024 * 1024;
    const text = JSON.stringify([
      { type: 'input_text', text: 'Screenshot captured' },
      { type: 'input_image', image_url: `data:image/png;base64,${base64Of(decoded)}`, detail: 'high' },
    ]);

    const result = boundToolResultText(text);

    expect(result.bounded).toBe(true);
    expect(result.text).toContain('[image: png, 1024 KB]');
    expect(result.text).not.toContain('data:image');
    expect(result.text).toContain('Screenshot captured');
    expect(JSON.parse(result.text)).toEqual([
      { type: 'input_text', text: 'Screenshot captured' },
      { type: 'input_image', image_url: '[image: png, 1024 KB]', detail: 'high' },
    ]);
  });

  it('keeps the first and last 32,768 characters of a 200,000-character string', () => {
    const text = Array.from({ length: 200_000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');

    const result = boundToolResultText(text);

    expect(result.bounded).toBe(true);
    expect(result.text.startsWith(text.slice(0, 32_768))).toBe(true);
    expect(result.text.endsWith(text.slice(-32_768))).toBe(true);
    expect(result.text).toContain('\n\n… [134,464 characters omitted] …\n\n');
    expect(result.text.length).toBe(32_768 * 2 + '\n\n… [134,464 characters omitted] …\n\n'.length);
  });

  it('returns an unchanged string under the cap as the same reference', () => {
    const text = `small tool output ${'x'.repeat(100)}`;

    const result = boundToolResultText(text);

    expect(result.bounded).toBe(false);
    expect(result.text).toBe(text);
  });

  it('reports a string that already holds a placeholder as bounded', () => {
    const result = boundToolResultText('before [image: png, 12 KB] after');

    expect(result.bounded).toBe(true);
    expect(result.text).toBe('before [image: png, 12 KB] after');
  });

  it('never splits a surrogate pair at either cut point', () => {
    const chars = 'a'.repeat(200_000).split('');
    // A pair straddling the head cut (index 32,767/32,768) and one straddling the tail cut.
    chars[32_767] = '\uD83C';
    chars[32_768] = '\uDF0D';
    const tailStart = 200_000 - 32_768;
    chars[tailStart - 1] = '\uD83C';
    chars[tailStart] = '\uDF0D';
    const text = chars.join('');

    const result = boundToolResultText(text);

    expect(result.bounded).toBe(true);
    expect(LONE_SURROGATE.test(result.text)).toBe(false);
    expect(result.text).not.toContain('�');
  });
});

describe('retained-characters estimate', () => {
  const entry: WorkLogEntry = {
    id: 'call_1',
    createdAt: '2026-11-13T00:00:00.000Z',
    label: 'exec_command',
    detail: 'ls -la',
    result: 'output',
    command: 'ls',
    changedFiles: ['a.ts', 'bb.ts'],
    tone: 'tool',
    toolTitle: 'Shell',
    toolInput: { cmd: 'ls -la', opts: { cwd: '/w', flags: ['-l', '-a'] }, timeout: 10 },
    sequence: 3,
  };

  it('sums the string lengths of a work-log entry plus the row overhead', () => {
    const fields = 6 + 24 + 12 + 6 + 6 + 2 + 5; // id, createdAt, label, detail, result, command, toolTitle
    const changedFiles = 4 + 5;
    // keys: cmd(3) opts(4) cwd(3) flags(5) timeout(7); string values: 'ls -la'(6) '/w'(2) '-l'(2) '-a'(2)
    const toolInput = 3 + 4 + 3 + 5 + 7 + 6 + 2 + 2 + 2;
    expect(estimateWorkLogEntryChars(entry)).toBe(64 + fields + changedFiles + toolInput);
  });

  it('sums the string lengths of a message plus the row overhead', () => {
    const message: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      text: 'hello',
      turnId: 't1',
      createdAt: '2026-11-13T00:00:00.000Z',
    };
    expect(estimateMessageChars(message)).toBe(ROW_OVERHEAD_CHARS + 2 + 5 + 2 + 24);
    expect(estimateParseResultChars({ messages: [message], workLog: [entry] })).toBe(
      estimateMessageChars(message) + estimateWorkLogEntryChars(entry),
    );
  });
});
