/** PAN-4834 WI-1: HTTP/1.1 request bytes and the incremental response parser. */
import { describe, expect, it } from 'vitest';

import {
  HttpParseError,
  type HttpParseErrorCode,
  type ParseStep,
  ResponseParser,
  type ResponseParserOptions,
  serializeHead,
  serializeRequest,
} from '../http1.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const text = (bytes: Uint8Array): string => decoder.decode(bytes);
const bytes = (value: string): Uint8Array => encoder.encode(value);

type Done = Extract<ParseStep, { state: 'done' }>;

/** Pushes `input` in slices of `sliceSize` bytes and returns the first completed step, or null. */
function feed(parser: ResponseParser, input: Uint8Array, sliceSize: number): Done | null {
  for (let offset = 0; offset < input.length; offset += sliceSize) {
    const step = parser.push(input.subarray(offset, offset + sliceSize));
    if (step.state === 'done') {
      // Bytes after the completing slice belong to the leftover too.
      const rest = input.subarray(offset + sliceSize);
      return rest.length === 0 ? step : { ...step, leftover: concat(step.leftover, rest) };
    }
  }
  return null;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function parse(raw: string, sliceSize: number, options: Partial<ResponseParserOptions> = {}): Done {
  const step = feed(new ResponseParser({ method: 'GET', ...options }), bytes(raw), sliceSize);
  if (!step) throw new Error('response did not complete');
  return step;
}

function expectCode(fn: () => unknown, code: HttpParseErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpParseError);
  expect((caught as HttpParseError).code).toBe(code);
}

describe('serializeRequest', () => {
  it('writes the exact GET head and drops the caller Origin, Cookie and Host', () => {
    const out = serializeRequest({
      method: 'GET',
      path: '/api/issues?limit=5',
      headers: [
        ['Origin', 'capacitor://localhost'],
        ['Cookie', 'session=abc'],
        ['Host', 'localhost'],
        ['Authorization', 'Bearer t0k'],
        ['accept', 'application/json'],
      ],
    });
    expect(text(out)).toBe(
      [
        'GET /api/issues?limit=5 HTTP/1.1',
        'Host: link.invalid',
        'Connection: keep-alive',
        'Accept-Encoding: identity',
        'Authorization: Bearer t0k',
        'accept: application/json',
        '',
        '',
      ].join('\r\n'),
    );
  });

  it('adds Content-Length for a body and replaces the caller framing headers', () => {
    const out = serializeRequest({
      method: 'POST',
      path: '/api/x',
      headers: {
        'content-length': '99',
        'Transfer-Encoding': 'chunked',
        Connection: 'close',
        'Keep-Alive': 'timeout=1',
        Upgrade: 'websocket',
        'Accept-Encoding': 'gzip',
        'content-type': 'text/plain',
      },
      body: bytes('hello'),
    });
    expect(text(out)).toBe(
      [
        'POST /api/x HTTP/1.1',
        'Host: link.invalid',
        'Connection: keep-alive',
        'Accept-Encoding: identity',
        'content-type: text/plain',
        'Content-Length: 5',
        '',
        'hello',
      ].join('\r\n'),
    );
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('sends Content-Length: 0 for a bodiless %s', (method) => {
    expect(text(serializeRequest({ method, path: '/api/x' }))).toContain('\r\nContent-Length: 0\r\n\r\n');
  });

  it('sends no Content-Length for a bodiless GET', () => {
    expect(text(serializeRequest({ method: 'GET', path: '/' }))).not.toMatch(/content-length/i);
  });
});

describe('serializeHead', () => {
  it('rejects a lowercase method, a path with a space and a value with CRLF', () => {
    expect(() => serializeHead('get', '/', [])).toThrow(TypeError);
    expect(() => serializeHead('GET', '/a b', [])).toThrow(TypeError);
    expect(() => serializeHead('GET', 'api/x', [])).toThrow(TypeError);
    expect(() => serializeHead('GET', '/', [['X-Evil', 'a\r\nInjected: 1']])).toThrow(TypeError);
    expect(() => serializeHead('GET', '/', [['Bad Name', 'v']])).toThrow(TypeError);
    expect(() => serializeHead('GET', '/', [['X-Nul', 'a\0b']])).toThrow(TypeError);
  });
});

describe.each([
  ['1-byte slices', 1],
  ['one chunk', Number.POSITIVE_INFINITY],
])('ResponseParser fed in %s', (_label, sliceSize) => {
  it('reads a content-length body', () => {
    const step = parse('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\n\r\nhello', sliceSize);
    expect(step.response.status).toBe(200);
    expect(step.response.statusText).toBe('OK');
    expect(step.response.httpVersion).toBe('1.1');
    expect(step.response.headers).toEqual([
      ['content-type', 'text/plain'],
      ['content-length', '5'],
    ]);
    expect(text(step.response.body)).toBe('hello');
    expect(step.keepAlive).toBe(true);
    expect(step.keepAliveTimeoutMs).toBeNull();
    expect(step.leftover.length).toBe(0);
  });

  it('reads a chunked body with a chunk extension and a trailer', () => {
    const step = parse(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n' +
        '5;name=value\r\nhello\r\n7\r\n, world\r\n0\r\nX-Trailer: yes\r\n\r\n',
      sliceSize,
    );
    expect(text(step.response.body)).toBe('hello, world');
    expect(step.keepAlive).toBe(true);
    expect(step.leftover.length).toBe(0);
  });

  it('reads a body to the end of the stream when it has no length', () => {
    const parser = new ResponseParser({ method: 'GET' });
    expect(feed(parser, bytes('HTTP/1.1 200 OK\r\n\r\nstreamed until close'), sliceSize)).toBeNull();
    const step = parser.end();
    if (step.state !== 'done') throw new Error('expected done');
    expect(text(step.response.body)).toBe('streamed until close');
    expect(step.keepAlive).toBe(false);
    expect(step.leftover.length).toBe(0);
  });

  it('gives a HEAD response with content-length no body', () => {
    const step = parse('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n', sliceSize, { method: 'HEAD' });
    expect(step.response.body.length).toBe(0);
    expect(step.keepAlive).toBe(true);
  });

  it.each([204, 304])('gives a %i response no body', (status) => {
    const step = parse(`HTTP/1.1 ${status} Nothing\r\nContent-Length: 4\r\n\r\n`, sliceSize);
    expect(step.response.status).toBe(status);
    expect(step.response.body.length).toBe(0);
  });

  it('discards a 100 Continue before the 200', () => {
    const step = parse('HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok', sliceSize);
    expect(step.response.status).toBe(200);
    expect(text(step.response.body)).toBe('ok');
  });

  it('completes a 101 at the end of the head and keeps the 3 extra bytes', () => {
    const step = parse('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nabc', sliceSize);
    expect(step.response.status).toBe(101);
    expect(step.response.body.length).toBe(0);
    expect(step.keepAlive).toBe(false);
    expect(text(step.leftover)).toBe('abc');
  });

  it('returns a pipelined second response in the leftover', () => {
    const second = 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n';
    const step = parse(`HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\nx${second}`, sliceSize);
    expect(text(step.response.body)).toBe('x');
    expect(text(step.leftover)).toBe(second);
  });

  it('turns keep-alive off for connection: close and on for HTTP/1.0 keep-alive', () => {
    expect(parse('HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', sliceSize).keepAlive).toBe(false);
    expect(parse('HTTP/1.0 200 OK\r\nContent-Length: 0\r\n\r\n', sliceSize).keepAlive).toBe(false);
    const http10 = parse('HTTP/1.0 200 OK\r\nConnection: Keep-Alive\r\nContent-Length: 0\r\n\r\n', sliceSize);
    expect(http10.response.httpVersion).toBe('1.0');
    expect(http10.keepAlive).toBe(true);
  });

  it('reads keep-alive: timeout=5 as 5000 ms', () => {
    const step = parse('HTTP/1.1 200 OK\r\nKeep-Alive: timeout=5\r\nContent-Length: 0\r\n\r\n', sliceSize);
    expect(step.keepAliveTimeoutMs).toBe(5000);
  });

  it('accepts identical repeated content-length values', () => {
    const step = parse('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\nok', sliceSize);
    expect(text(step.response.body)).toBe('ok');
  });

  it('marks the parser responded after the first byte', () => {
    const parser = new ResponseParser({ method: 'GET' });
    expect(parser.responded).toBe(false);
    parser.push(bytes('H'));
    expect(parser.responded).toBe(true);
  });

  describe('errors', () => {
    const fail = (raw: string, code: HttpParseErrorCode, options: Partial<ResponseParserOptions> = {}): void =>
      expectCode(() => feed(new ResponseParser({ method: 'GET', ...options }), bytes(raw), sliceSize), code);

    it('bad-status-line', () => {
      fail('HTTP/2 200 OK\r\n\r\n', 'bad-status-line');
      fail('HTTP/1.1 20 OK\r\n\r\n', 'bad-status-line');
    });

    it('bad-header', () => {
      fail('HTTP/1.1 200 OK\r\nno colon here\r\n\r\n', 'bad-header');
      fail('HTTP/1.1 200 OK\r\nX-A: 1\r\n folded\r\n\r\n', 'bad-header');
      fail('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\nok', 'bad-header');
      fail('HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n', 'bad-header');
    });

    it('headers-too-large', () => {
      fail(`HTTP/1.1 200 OK\r\nX-Big: ${'a'.repeat(100)}\r\n\r\n`, 'headers-too-large', { maxHeadBytes: 64 });
    });

    it('body-too-large for content-length, chunked and read-to-close bodies', () => {
      fail('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello', 'body-too-large', { maxBodyBytes: 4 });
      fail('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n3\r\ndef\r\n0\r\n\r\n', 'body-too-large', {
        maxBodyBytes: 4,
      });
      fail('HTTP/1.1 200 OK\r\n\r\nhello', 'body-too-large', { maxBodyBytes: 4 });
    });

    it('bad-chunk', () => {
      fail('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n', 'bad-chunk');
      fail('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabcX\r\n', 'bad-chunk');
    });

    it('truncated when the stream ends inside a content-length body', () => {
      const parser = new ResponseParser({ method: 'GET' });
      expect(feed(parser, bytes('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nhel'), sliceSize)).toBeNull();
      expectCode(() => parser.end(), 'truncated');
    });

    it('truncated when the stream ends before any byte or inside the head', () => {
      expectCode(() => new ResponseParser({ method: 'GET' }).end(), 'truncated');
      const parser = new ResponseParser({ method: 'GET' });
      feed(parser, bytes('HTTP/1.1 200 OK\r\nContent-'), sliceSize);
      expectCode(() => parser.end(), 'truncated');
    });
  });
});
