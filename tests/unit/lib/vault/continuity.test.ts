import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  TAIL_HASH_COUNT,
  checkContinuity,
  lineHash,
  splitSettleableLines,
  tailOf,
} from '../../../../src/lib/vault/continuity.js';

function jsonLines(count: number, prefix = 'msg'): string[] {
  return Array.from({ length: count }, (_, i) => JSON.stringify({ type: 'user', text: `${prefix} ${i}` }));
}

describe('vault continuity: lineHash', () => {
  it('is the first 16 hex chars of SHA-256 over the raw bytes', () => {
    const line = '{"a":1}';
    expect(lineHash(line)).toBe(createHash('sha256').update(line).digest('hex').slice(0, 16));
    expect(lineHash(line)).toHaveLength(16);
    expect(lineHash(Buffer.from(line))).toBe(lineHash(line));
    expect(lineHash('{"a":2}')).not.toBe(lineHash(line));
  });
});

describe('vault continuity: splitSettleableLines', () => {
  it('splits complete JSON lines and reports the consumed byte offset', () => {
    const lines = jsonLines(3);
    const text = `${lines.join('\n')}\n`;
    const result = splitSettleableLines(Buffer.from(text));
    expect(result.lines).toEqual(lines);
    expect(result.consumedBytes).toBe(Buffer.byteLength(text));
  });

  it('ac4: drops a trailing incomplete JSON line and returns it once completed', () => {
    const lines = jsonLines(2);
    const partial = '{"type":"user","text":"in prog';
    const first = splitSettleableLines(`${lines.join('\n')}\n${partial}`);
    expect(first.lines).toEqual(lines);
    expect(first.consumedBytes).toBe(Buffer.byteLength(`${lines.join('\n')}\n`));

    const completed = `${partial}ress"}`;
    const second = splitSettleableLines(`${lines.join('\n')}\n${completed}\n`);
    expect(second.lines).toEqual([...lines, completed]);
    expect(second.consumedBytes).toBe(Buffer.byteLength(`${lines.join('\n')}\n${completed}\n`));
  });

  it('a final complete line with no newline consumes exactly its bytes, and blank lines stay outside', () => {
    const lines = jsonLines(2);
    const noNewline = splitSettleableLines(`${lines.join('\n')}\n${lines[1]}`);
    expect(noNewline.lines).toEqual([...lines, lines[1]]);
    expect(noNewline.consumedBytes).toBe(Buffer.byteLength(`${lines.join('\n')}\n${lines[1]}`));
    const blankTail = splitSettleableLines(`${lines.join('\n')}\n\n`);
    expect(blankTail.lines).toEqual(lines);
    expect(blankTail.consumedBytes).toBe(Buffer.byteLength(`${lines.join('\n')}\n`));
    const blankMiddle = splitSettleableLines(`${lines[0]}\n\n${lines[1]}\n`);
    expect(blankMiddle.lines).toEqual(lines);
    expect(blankMiddle.consumedBytes).toBe(Buffer.byteLength(`${lines[0]}\n\n${lines[1]}\n`));
  });

  it('drops a trailing complete-looking line that is not valid JSON', () => {
    const lines = jsonLines(1);
    const result = splitSettleableLines(`${lines[0]}\n{"broken":\n`);
    expect(result.lines).toEqual(lines);
  });

  it('handles empty input and multi-byte characters', () => {
    expect(splitSettleableLines('')).toEqual({ lines: [], consumedBytes: 0 });
    const line = JSON.stringify({ text: 'héllo → 世界' });
    const result = splitSettleableLines(`${line}\n`);
    expect(result.lines).toEqual([line]);
    expect(result.consumedBytes).toBe(Buffer.byteLength(line) + 1);
  });
});

describe('vault continuity: checkContinuity', () => {
  it('tailOf keeps at most 16 trailing hashes', () => {
    const lines = jsonLines(40);
    const tail = tailOf(lines, 1234);
    expect(tail.lineCount).toBe(40);
    expect(tail.byteOffset).toBe(1234);
    expect(tail.lastHashes).toHaveLength(TAIL_HASH_COUNT);
    expect(tail.lastHashes).toEqual(lines.slice(24).map((line) => lineHash(line)));
    expect(tailOf(jsonLines(3), 0).lastHashes).toHaveLength(3);
  });

  it('ac1: an unchanged live file is noop', () => {
    const lines = jsonLines(30);
    expect(checkContinuity(tailOf(lines, 0), lines)).toEqual({ verdict: 'noop' });
  });

  it('ac2: a live file that only grew is append with the new lines', () => {
    const saved = jsonLines(30);
    const added = jsonLines(3, 'new');
    const result = checkContinuity(tailOf(saved, 0), [...saved, ...added]);
    expect(result).toEqual({ verdict: 'append', newLines: added });
  });

  it('ac3: a changed line inside the last 16 saved lines is diverged', () => {
    const saved = jsonLines(30);
    const live = [...saved, ...jsonLines(2, 'new')];
    live[20] = JSON.stringify({ type: 'user', text: 'edited' });
    const result = checkContinuity(tailOf(saved, 0), live);
    expect(result.verdict).toBe('diverged');
    expect(result).toMatchObject({ reason: expect.stringContaining('line 21') });
  });

  it('a live file shorter than the saved tail is diverged', () => {
    const saved = jsonLines(10);
    const result = checkContinuity(tailOf(saved, 0), saved.slice(0, 5));
    expect(result.verdict).toBe('diverged');
  });

  it('an empty tail appends everything, or is noop on an empty file', () => {
    const empty = tailOf([], 0);
    expect(checkContinuity(empty, [])).toEqual({ verdict: 'noop' });
    const lines = jsonLines(2);
    expect(checkContinuity(empty, lines)).toEqual({ verdict: 'append', newLines: lines });
  });

  it('a short history compares only the lines that exist', () => {
    const saved = jsonLines(3);
    expect(checkContinuity(tailOf(saved, 0), [...saved, ...jsonLines(1, 'x')]).verdict).toBe('append');
  });
});
