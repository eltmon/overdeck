import { describe, expect, it } from 'vitest';
import { encodePrimeAgentJsonl, PRIME_AGENT_MAX_RECORD_BYTES, PrimeAgentJsonlError, PrimeAgentJsonlFramer } from '../jsonl-framing.js';

/** Records only, for the cases where the error channel is expected to stay empty. */
function records(framer: PrimeAgentJsonlFramer, chunk: Uint8Array): unknown[] {
  const result = framer.push(chunk);
  expect(result.errors).toEqual([]);
  return result.records;
}

describe('PrimeAgentJsonlFramer', () => {
  it('preserves U+2028 and U+2029 inside a JSON string', () => {
    const framer = new PrimeAgentJsonlFramer();
    expect(records(framer, Buffer.from('{"text":"left\u2028middle\u2029right"}\n'))).toEqual([
      { text: 'left\u2028middle\u2029right' },
    ]);
  });

  it('parses split and combined LF-delimited records', () => {
    const framer = new PrimeAgentJsonlFramer();
    expect(records(framer, Buffer.from('{"id":1'))).toEqual([]);
    expect(records(framer, Buffer.from('}\n{"id":2}\n'))).toEqual([{ id: 1 }, { id: 2 }]);
    framer.finish();
  });

  it('handles a large record delivered one byte at a time', () => {
    const framer = new PrimeAgentJsonlFramer();
    const input = Buffer.from(`${JSON.stringify({ text: 'x'.repeat(64 * 1024) })}\n`);
    const collected: unknown[] = [];
    for (const byte of input) collected.push(...records(framer, Uint8Array.of(byte)));
    expect(collected).toEqual([{ text: 'x'.repeat(64 * 1024) }]);
  });

  it('strips one CR from CRLF records', () => {
    const framer = new PrimeAgentJsonlFramer();
    expect(records(framer, Buffer.from('{"ok":true}\r\n'))).toEqual([{ ok: true }]);
  });

  it('reports a malformed record per record, without logging its contents', () => {
    const framer = new PrimeAgentJsonlFramer();
    const result = framer.push(Buffer.from('{"secret":"redacted",}\n'));
    expect(result.records).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(PrimeAgentJsonlError);
    expect(result.errors[0]!.message).toMatch(/Malformed Prime Agent RPC JSON record \(22 bytes\)/);
    expect(result.errors[0]!.message).not.toContain('redacted');
  });

  it('keeps parsing later records after a malformed one (rpc-framing.ac3)', () => {
    const framer = new PrimeAgentJsonlFramer();
    const result = framer.push(Buffer.from('{"id":1}\nnot json at all\n{"id":2}\n'));
    expect(result.records).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.errors).toHaveLength(1);
    // The boundary state survived the bad record, so a record split across the
    // NEXT chunk still reassembles correctly.
    expect(records(framer, Buffer.from('{"id":'))).toEqual([]);
    expect(records(framer, Buffer.from('3}\n'))).toEqual([{ id: 3 }]);
  });

  it('reports a malformed record that arrives split across chunks and recovers', () => {
    const framer = new PrimeAgentJsonlFramer();
    expect(records(framer, Buffer.from('{"broken":'))).toEqual([]);
    const result = framer.push(Buffer.from('}\n{"id":9}\n'));
    expect(result.records).toEqual([{ id: 9 }]);
    expect(result.errors).toHaveLength(1);
    framer.finish();
  });

  it('reports completed and buffered records over the byte limit and resynchronises', () => {
    const completed = new PrimeAgentJsonlFramer({ maxRecordBytes: 4 }).push(Buffer.from('12345\n'));
    expect(completed.records).toEqual([]);
    expect(completed.errors[0]!.message).toMatch('4-byte limit');

    const framer = new PrimeAgentJsonlFramer({ maxRecordBytes: 8 });
    const buffered = framer.push(Buffer.from('123456789'));
    expect(buffered.errors[0]!.message).toMatch('8-byte limit');
    // The oversized prefix was dropped rather than retained, so the framer is
    // back in sync on the next newline and does not keep growing.
    expect(records(framer, Buffer.from('\n{"id":1}\n'))).toEqual([{ id: 1 }]);
  });

  it('defaults the record limit to 16 MiB', () => {
    expect(PRIME_AGENT_MAX_RECORD_BYTES).toBe(16 * 1024 * 1024);
    const framer = new PrimeAgentJsonlFramer();
    const result = framer.push(Buffer.alloc(PRIME_AGENT_MAX_RECORD_BYTES + 1, 0x61));
    expect(result.errors[0]!.message).toContain(`${PRIME_AGENT_MAX_RECORD_BYTES}-byte limit`);
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
