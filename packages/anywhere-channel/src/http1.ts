/**
 * HTTP/1.1 over a secure channel, byte level (PAN-4834 WI-1).
 *
 * Inside a channel the machine speaks plain HTTP/1.1 to its Node HTTP server.
 * A WebView cannot point `fetch` at a byte stream, so the phone writes the
 * request bytes itself ({@link serializeRequest}) and parses the response
 * ({@link ResponseParser}). Both are pure: no streams, no timers.
 *
 * Header hygiene (PAN-4834 NFR-4): every request carries `Host: link.invalid`,
 * `Connection: keep-alive` and `Accept-Encoding: identity`, and never the
 * caller's `Origin`, `Cookie` or framing headers. Phone credentials skip the
 * server's Origin and CSRF checks, and the machine-to-machine `ws` client
 * already sends no `Origin`.
 *
 * The parser is incremental: bytes can arrive one at a time. Bytes after a
 * completed response are returned as `leftover`, never dropped (the first
 * WebSocket frame can ride behind a 101).
 */
import b4a from 'b4a';

export type HeaderPairs = Array<[name: string, value: string]>;

export interface HttpRequest {
  method: string;
  path: string;
  headers?: HeaderPairs | Record<string, string>;
  body?: Uint8Array;
}

export interface HttpResponseHead {
  status: number;
  statusText: string;
  httpVersion: '1.0' | '1.1';
  /** Names lowercased, order kept. */
  headers: HeaderPairs;
}

export interface HttpResponse extends HttpResponseHead {
  body: Uint8Array;
}

export type HttpParseErrorCode =
  | 'bad-status-line'
  | 'bad-header'
  | 'headers-too-large'
  | 'body-too-large'
  | 'bad-chunk'
  | 'truncated';

export class HttpParseError extends Error {
  constructor(
    readonly code: HttpParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpParseError';
  }
}

export const CHANNEL_HOST = 'link.invalid';
export const MAX_RESPONSE_HEAD_BYTES = 64 * 1024;
export const MAX_RESPONSE_BODY_BYTES = 32 * 1024 * 1024;

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const METHOD = /^[A-Z]+$/;
const STATUS_LINE = /^HTTP\/1\.([01]) (\d{3})(?: (.*))?$/;
/** Caller headers the client always owns or must never send. */
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'accept-encoding',
  'origin',
  'cookie',
]);
const METHODS_WITH_EMPTY_BODY_LENGTH = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** A chunk-size line longer than this is malformed (hex size plus extensions). */
const MAX_CHUNK_LINE_BYTES = 4096;
const CR = 0x0d;
const LF = 0x0a;

const encoder = new TextEncoder();

/** Writes `METHOD SP path SP HTTP/1.1 CRLF`, the header lines and the blank line. */
export function serializeHead(method: string, path: string, headers: HeaderPairs): Uint8Array {
  if (!METHOD.test(method)) throw new TypeError(`Invalid HTTP method: ${JSON.stringify(method)}`);
  if (!path.startsWith('/') || /[ \r\n]/.test(path)) {
    throw new TypeError(`Invalid request path: ${JSON.stringify(path)}`);
  }
  let head = `${method} ${path} HTTP/1.1\r\n`;
  for (const [name, value] of headers) {
    if (!TOKEN.test(name)) throw new TypeError(`Invalid header name: ${JSON.stringify(name)}`);
    if (/[\r\n\0]/.test(value)) throw new TypeError(`Invalid value for header ${name}`);
    head += `${name}: ${value}\r\n`;
  }
  return encoder.encode(`${head}\r\n`);
}

/** The full request bytes: head followed by the body, if any. */
export function serializeRequest(req: HttpRequest): Uint8Array {
  const callerHeaders: HeaderPairs = Array.isArray(req.headers) ? req.headers : Object.entries(req.headers ?? {});
  const headers: HeaderPairs = [
    ['Host', CHANNEL_HOST],
    ['Connection', 'keep-alive'],
    ['Accept-Encoding', 'identity'],
  ];
  for (const [name, value] of callerHeaders) {
    if (!DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers.push([name, value]);
  }
  if (req.body) headers.push(['Content-Length', String(req.body.byteLength)]);
  else if (METHODS_WITH_EMPTY_BODY_LENGTH.has(req.method)) headers.push(['Content-Length', '0']);
  const head = serializeHead(req.method, req.path, headers);
  return req.body ? b4a.concat([head, req.body]) : head;
}

export type ParseStep =
  | { state: 'more' }
  | {
      state: 'done';
      response: HttpResponse;
      keepAlive: boolean;
      keepAliveTimeoutMs: number | null;
      leftover: Uint8Array;
    };

export interface ResponseParserOptions {
  /** The request method; `HEAD` responses have no body. */
  method: string;
  maxHeadBytes?: number;
  maxBodyBytes?: number;
}

type ParserState =
  | 'head'
  | 'content-length'
  | 'chunk-size'
  | 'chunk-data'
  | 'chunk-data-crlf'
  | 'trailers'
  | 'read-to-close'
  | 'done'
  | 'failed';

/** Parses one HTTP/1.x response from bytes pushed in any slicing. */
export class ResponseParser {
  private readonly method: string;
  private readonly maxHeadBytes: number;
  private readonly maxBodyBytes: number;
  private state: ParserState = 'head';
  private failure: HttpParseError | null = null;
  private seenBytes = false;
  /** Unconsumed bytes live in `buf[start..end)`. */
  private buf = new Uint8Array(1024);
  private start = 0;
  private end_ = 0;
  /** Where the next search for a line break begins, relative to `start`. */
  private scanFrom = 0;
  private head: HttpResponseHead | null = null;
  private bodyParts: Uint8Array[] = [];
  private bodyBytes = 0;
  /** Bytes still expected: the content-length remainder or the current chunk's remainder. */
  private remaining = 0;
  private trailerBytes = 0;

  constructor(options: ResponseParserOptions) {
    this.method = options.method.toUpperCase();
    this.maxHeadBytes = options.maxHeadBytes ?? MAX_RESPONSE_HEAD_BYTES;
    this.maxBodyBytes = options.maxBodyBytes ?? MAX_RESPONSE_BODY_BYTES;
  }

  /** True once any response byte was pushed. */
  get responded(): boolean {
    return this.seenBytes;
  }

  push(chunk: Uint8Array): ParseStep {
    this.assertUsable();
    if (chunk.byteLength > 0) this.seenBytes = true;
    this.append(chunk);
    try {
      return this.run();
    } catch (error) {
      this.state = 'failed';
      if (error instanceof HttpParseError) this.failure = error;
      throw error;
    }
  }

  /** The stream ended. Completes a read-to-close body; anything else is truncated. */
  end(): ParseStep {
    this.assertUsable();
    if (this.state === 'read-to-close') {
      this.state = 'done';
      return this.finish(false);
    }
    this.state = 'failed';
    this.failure = new HttpParseError('truncated', 'The channel ended before the response was complete');
    throw this.failure;
  }

  private assertUsable(): void {
    if (this.state === 'done') throw new Error('ResponseParser already completed a response');
    if (this.state === 'failed') throw this.failure ?? new Error('ResponseParser failed');
  }

  private run(): ParseStep {
    for (;;) {
      switch (this.state) {
        case 'head': {
          const lineEnd = this.findHeadEnd();
          if (lineEnd < 0) return { state: 'more' };
          const step = this.onHead(lineEnd);
          if (step) return step;
          break;
        }
        case 'content-length': {
          this.takeBody();
          if (this.remaining > 0) return { state: 'more' };
          this.state = 'done';
          return this.finish(this.keepAliveFor(this.requireHead()));
        }
        case 'chunk-size': {
          const line = this.takeLine(MAX_CHUNK_LINE_BYTES, 'bad-chunk', 'Chunk-size line is too long');
          if (line === null) return { state: 'more' };
          const sizeText = line.split(';', 1)[0].trim();
          if (!/^[0-9A-Fa-f]{1,15}$/.test(sizeText)) {
            throw new HttpParseError('bad-chunk', `Malformed chunk size: ${JSON.stringify(sizeText)}`);
          }
          const size = Number.parseInt(sizeText, 16);
          if (size === 0) {
            this.state = 'trailers';
          } else {
            this.checkBodySize(this.bodyBytes + size);
            this.remaining = size;
            this.state = 'chunk-data';
          }
          break;
        }
        case 'chunk-data': {
          this.takeBody();
          if (this.remaining > 0) return { state: 'more' };
          this.state = 'chunk-data-crlf';
          break;
        }
        case 'chunk-data-crlf': {
          if (this.end_ - this.start < 2) {
            if (this.end_ > this.start && this.buf[this.start] !== CR) {
              throw new HttpParseError('bad-chunk', 'Chunk data is not followed by CRLF');
            }
            return { state: 'more' };
          }
          if (this.buf[this.start] !== CR || this.buf[this.start + 1] !== LF) {
            throw new HttpParseError('bad-chunk', 'Chunk data is not followed by CRLF');
          }
          this.consume(2);
          this.state = 'chunk-size';
          break;
        }
        case 'trailers': {
          const budget = this.maxHeadBytes - this.trailerBytes;
          const line = this.takeLine(budget, 'headers-too-large', 'Response trailers are too large');
          if (line === null) return { state: 'more' };
          this.trailerBytes += line.length + 2;
          if (line !== '') break;
          this.state = 'done';
          return this.finish(this.keepAliveFor(this.requireHead()));
        }
        case 'read-to-close': {
          const available = this.end_ - this.start;
          if (available > 0) {
            this.checkBodySize(this.bodyBytes + available);
            this.bodyParts.push(this.buf.slice(this.start, this.end_));
            this.bodyBytes += available;
            this.consume(available);
          }
          return { state: 'more' };
        }
        case 'done':
        case 'failed':
          throw new Error(`ResponseParser cannot run in state ${this.state}`);
      }
    }
  }

  /** Handles a complete head ending at `headEnd` (the index after the blank line). */
  private onHead(headEnd: number): ParseStep | null {
    const text = latin1(this.buf.subarray(this.start, headEnd - 4));
    this.consume(headEnd - this.start);
    const head = parseHead(text);
    if (head.status >= 100 && head.status < 200 && head.status !== 101) return null;
    this.head = head;
    if (head.status === 101) {
      this.state = 'done';
      return this.finish(false);
    }
    if (this.method === 'HEAD' || head.status === 204 || head.status === 304) {
      this.state = 'done';
      return this.finish(this.keepAliveFor(head));
    }
    const transferEncoding = headerValues(head, 'transfer-encoding')
      .flatMap((value) => value.split(','))
      .map((coding) => coding.trim().toLowerCase())
      .filter((coding) => coding !== '');
    if (transferEncoding.length > 0) {
      this.state = transferEncoding[transferEncoding.length - 1] === 'chunked' ? 'chunk-size' : 'read-to-close';
      return null;
    }
    const lengths = headerValues(head, 'content-length').flatMap((value) => value.split(',').map((v) => v.trim()));
    if (lengths.length > 0) {
      if (!lengths.every((value) => /^\d+$/.test(value)) || new Set(lengths).size !== 1) {
        throw new HttpParseError('bad-header', `Invalid content-length: ${JSON.stringify(lengths.join(', '))}`);
      }
      const length = Number(lengths[0]);
      this.checkBodySize(length);
      this.remaining = length;
      this.state = 'content-length';
      return null;
    }
    this.state = 'read-to-close';
    return null;
  }

  private finish(keepAlive: boolean): ParseStep {
    const head = this.requireHead();
    const leftover = this.buf.slice(this.start, this.end_);
    this.consume(this.end_ - this.start);
    const body = this.bodyParts.length === 1 ? this.bodyParts[0] : b4a.concat(this.bodyParts, this.bodyBytes);
    this.bodyParts = [];
    const timeout = headerValues(head, 'keep-alive')
      .flatMap((value) => value.split(','))
      .map((param) => /^\s*timeout\s*=\s*(\d+)\s*$/i.exec(param))
      .find((match) => match !== null);
    return {
      state: 'done',
      response: { ...head, body },
      keepAlive,
      keepAliveTimeoutMs: timeout ? Number(timeout[1]) * 1000 : null,
      leftover,
    };
  }

  private keepAliveFor(head: HttpResponseHead): boolean {
    const tokens = headerValues(head, 'connection').flatMap((value) =>
      value.split(',').map((token) => token.trim().toLowerCase()),
    );
    return head.httpVersion === '1.1' ? !tokens.includes('close') : tokens.includes('keep-alive');
  }

  private requireHead(): HttpResponseHead {
    if (!this.head) throw new Error('ResponseParser has no response head');
    return this.head;
  }

  private checkBodySize(total: number): void {
    if (total > this.maxBodyBytes) {
      throw new HttpParseError('body-too-large', `Response body exceeds ${this.maxBodyBytes} bytes`);
    }
  }

  /** Moves up to `remaining` buffered bytes into the body. */
  private takeBody(): void {
    const take = Math.min(this.remaining, this.end_ - this.start);
    if (take === 0) return;
    this.bodyParts.push(this.buf.slice(this.start, this.start + take));
    this.bodyBytes += take;
    this.remaining -= take;
    this.consume(take);
  }

  /** Returns the absolute index just past `\r\n\r\n`, or -1 when the head is not complete yet. */
  private findHeadEnd(): number {
    const buffered = this.end_ - this.start;
    for (let i = this.start + Math.max(0, this.scanFrom - 3); i + 3 < this.end_; i++) {
      if (this.buf[i] === CR && this.buf[i + 1] === LF && this.buf[i + 2] === CR && this.buf[i + 3] === LF) {
        if (i + 4 - this.start > this.maxHeadBytes) break;
        this.scanFrom = 0;
        return i + 4;
      }
    }
    if (buffered > this.maxHeadBytes) {
      throw new HttpParseError('headers-too-large', `Response head exceeds ${this.maxHeadBytes} bytes`);
    }
    this.scanFrom = buffered;
    return -1;
  }

  /** Takes one CRLF-terminated line, or returns null when it is not complete yet. */
  private takeLine(maxBytes: number, code: HttpParseErrorCode, message: string): string | null {
    const buffered = this.end_ - this.start;
    for (let i = this.start + Math.max(0, this.scanFrom - 1); i + 1 < this.end_; i++) {
      if (this.buf[i] === CR && this.buf[i + 1] === LF) {
        if (i + 2 - this.start > maxBytes) break;
        const line = latin1(this.buf.subarray(this.start, i));
        this.consume(i + 2 - this.start);
        return line;
      }
    }
    if (buffered > maxBytes) throw new HttpParseError(code, message);
    this.scanFrom = buffered;
    return null;
  }

  private consume(count: number): void {
    this.start += count;
    this.scanFrom = 0;
    if (this.start === this.end_) {
      this.start = 0;
      this.end_ = 0;
    }
  }

  private append(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    if (this.end_ + chunk.byteLength > this.buf.byteLength) {
      const live = this.end_ - this.start;
      const needed = live + chunk.byteLength;
      if (needed > this.buf.byteLength) {
        const next = new Uint8Array(Math.max(needed, this.buf.byteLength * 2));
        next.set(this.buf.subarray(this.start, this.end_), 0);
        this.buf = next;
      } else {
        this.buf.copyWithin(0, this.start, this.end_);
      }
      this.start = 0;
      this.end_ = live;
    }
    this.buf.set(chunk, this.end_);
    this.end_ += chunk.byteLength;
  }
}

function parseHead(text: string): HttpResponseHead {
  const lines = text.split('\r\n');
  const statusLine = STATUS_LINE.exec(lines[0]);
  if (!statusLine) throw new HttpParseError('bad-status-line', `Malformed status line: ${JSON.stringify(lines[0])}`);
  const headers: HeaderPairs = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      throw new HttpParseError('bad-header', 'Obsolete line folding is not accepted');
    }
    const colon = line.indexOf(':');
    const name = colon < 0 ? '' : line.slice(0, colon);
    if (!TOKEN.test(name)) throw new HttpParseError('bad-header', `Malformed header line: ${JSON.stringify(line)}`);
    headers.push([name.toLowerCase(), line.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, '')]);
  }
  return {
    status: Number(statusLine[2]),
    statusText: statusLine[3] ?? '',
    httpVersion: statusLine[1] === '0' ? '1.0' : '1.1',
    headers,
  };
}

function headerValues(head: HttpResponseHead, name: string): string[] {
  return head.headers.filter(([key]) => key === name).map(([, value]) => value);
}

/** Header bytes are ISO-8859-1, as browsers and Node read them; every result char fits a ByteString. */
function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return text;
}
