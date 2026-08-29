import { describe, expect, it } from 'vitest';
import { encodePrimeAgentJsonl, PrimeAgentJsonlError, PrimeAgentJsonlFramer } from '../jsonl-framing.js';

describe('PrimeAgentJsonlFramer', () => {
  it('preserves U+2028 and U+2029 inside a JSON string', () => {
    const framer = new PrimeAgentJsonlFramer();
    expect(framer.push(Buffer.from('{"text":"left middle right"}\n'))).toEqual([
      { text: 'left middle right' },
    ]);
  });

  it('parses split and combined LF-delimited records', () => {
    const framer = new PrimeAgentJsonlFramer();
    expect(framer.push(Buffer.from('{"id":1'))).toEqual([]);
    expect(framer.push(Buffer.from('}\n{"id":2}\n'))).toEqual([{ id: 1 }, { id: 2 }]);
    framer.finish();
  });

  it('handles a large record delivered one byte at a time', () => {
    const framer = new PrimeAgentJsonlFramer();
    const input = Buffer.from(`${JSON.stringify({ text: 'x'.repeat(64 * 1024) })}\n`);
    const records: unknown[] = [];
    for (const byte of input) records.push(...framer.push(Uint8Array.of(byte)));
    expect(records).toEqual([{ text: 'x'.repeat(64 * 1024) }]);
  });

  it('strips one CR from CRLF records', () => {
    const framer = new PrimeAgentJsonlFramer();
    expect(framer.push(Buffer.from('{"ok":true}\r\n'))).toEqual([{ ok: true }]);
  });

  it('rejects malformed JSON without logging record contents', () => {
    const framer = new PrimeAgentJsonlFramer();
    expect(() => framer.push(Buffer.from('{"secret":"redacted",}\n'))).toThrow(PrimeAgentJsonlError);
    expect(() => framer.push(Buffer.from('{"secret":"redacted",}\n'))).toThrow(/Malformed Prime Agent RPC JSON record \(22 bytes\)/);
  });

  it('rejects completed and buffered records over the byte limit', () => {
    expect(() => new PrimeAgentJsonlFramer({ maxRecordBytes: 4 }).push(Buffer.from('12345\n'))).toThrow('4-byte limit');
    expect(() => new PrimeAgentJsonlFramer({ maxRecordBytes: 4 }).push(Buffer.from('12345'))).toThrow('4-byte limit');
  });

  it('rejects an unterminated final record', () => {
    const framer = new PrimeAgentJsonlFramer();
    framer.push(Buffer.from('{"id":1}'));
    expect(() => framer.finish()).toThrow('unterminated');
  });
});

describe('encodePrimeAgentJsonl', () => {
  it('emits exactly one trailing LF', () => {
    expect(encodePrimeAgentJsonl({ command: 'get_state' }).toString('utf8')).toBe('{"command":"get_state"}\n');
  });
});
