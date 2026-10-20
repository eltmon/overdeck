/**
 * Protocol capture sink (PAN-4563).
 *
 * Records every JSON-RPC frame of a live harness session, in observed order,
 * to an `overdeck-protocol-capture/1` fixture. Each frame is scrubbed before it
 * is queued, so raw secrets never reach disk. Capture is off unless a caller
 * passes a sink or `OVERDECK_PROTOCOL_CAPTURE_DIR` names an absolute dir.
 *
 * Writes are async (`fs/promises`) and go through one promise chain, so file
 * order equals call order. A write failure is reported once on stderr and never
 * reaches the session being captured.
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { AppServerTransport } from '../codex/app-server-transport.js';
import {
  PROTOCOL_CAPTURE_FORMAT,
  type FrameDirection,
  type ProtocolFixtureHeader,
  type ProtocolFrame,
} from './fixture.js';
import { scrubValue, type ScrubContext } from './scrub.js';

export const PROTOCOL_CAPTURE_DIR_ENV = 'OVERDECK_PROTOCOL_CAPTURE_DIR';

export interface ProtocolCaptureSink {
  readonly path: string;
  /** Before the first frame only; later calls are ignored. */
  setHeader(fields: Partial<Pick<ProtocolFixtureHeader, 'cliVersion' | 'scenario' | 'hostOptions' | 'provider'>>): void;
  /** Scrub, then queue. */
  recordMessage(dir: FrameDirection, message: unknown): void;
  /** JSON.parse to a message, else a text frame; scrub; queue. */
  recordText(dir: FrameDirection, line: string): void;
  /** Per-direction line buffer; each complete non-empty line goes to recordText. */
  recordChunk(dir: FrameDirection, chunk: string): void;
  /** Flush partial lines as frames and await all writes. */
  close(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createProtocolCaptureSink(input: {
  path: string;
  harness: ProtocolFixtureHeader['harness'];
  scrub: ScrubContext;
  now?: () => number;
  recordedAt?: string;
}): ProtocolCaptureSink {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const header: ProtocolFixtureHeader = {
    type: 'header',
    format: PROTOCOL_CAPTURE_FORMAT,
    harness: input.harness,
    provider: null,
    cliVersion: null,
    scenario: null,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    hostOptions: null,
    scrubbed: true,
  };
  const buffers: Record<FrameDirection, string> = { out: '', in: '' };
  let headerQueued = false;
  let closed = false;
  let seq = 0;
  let reportedError = false;
  let chain: Promise<void> = Promise.resolve();
  let madeDir = false;

  /** The header write truncates, so one sink always yields one fixture. */
  const append = (line: string, options: { truncate?: boolean } = {}): void => {
    chain = chain
      .then(async () => {
        if (!madeDir) {
          await mkdir(dirname(input.path), { recursive: true });
          madeDir = true;
        }
        if (options.truncate) await writeFile(input.path, `${line}\n`, { mode: 0o600 });
        else await appendFile(input.path, `${line}\n`, { mode: 0o600 });
      })
      .catch((error: unknown) => {
        if (reportedError) return;
        reportedError = true;
        process.stderr.write(`[protocol-capture] write to ${input.path} failed: ${(error as Error).message}\n`);
      });
  };

  const queueHeader = (): void => {
    if (headerQueued) return;
    headerQueued = true;
    append(JSON.stringify(scrubValue(header, input.scrub)), { truncate: true });
  };

  const queueFrame = (dir: FrameDirection, body: Pick<ProtocolFrame, 'message' | 'text'>): void => {
    if (closed) return;
    queueHeader();
    const frame: ProtocolFrame = { type: 'frame', seq, dir, t: now() - startedAt, ...body };
    seq += 1;
    append(JSON.stringify(frame));
  };

  const scrubbedBody = (value: unknown, raw: string): Pick<ProtocolFrame, 'message' | 'text'> => {
    if (isRecord(value)) return { message: scrubValue(value, input.scrub) as Record<string, unknown> };
    return { text: scrubValue(raw, input.scrub) as string };
  };

  const recordText = (dir: FrameDirection, line: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = undefined;
    }
    queueFrame(dir, scrubbedBody(parsed, line));
  };

  const flushLines = (dir: FrameDirection, final: boolean): void => {
    const parts = buffers[dir].split('\n');
    buffers[dir] = final ? '' : parts.pop() ?? '';
    for (const part of parts) {
      const line = part.endsWith('\r') ? part.slice(0, -1) : part;
      if (line.trim() !== '') recordText(dir, line);
    }
  };

  return {
    path: input.path,
    setHeader(fields) {
      if (headerQueued) return;
      Object.assign(header, fields);
    },
    recordMessage(dir, message) {
      queueFrame(dir, scrubbedBody(message, typeof message === 'string' ? message : JSON.stringify(message) ?? String(message)));
    },
    recordText,
    recordChunk(dir, chunk) {
      if (closed) return;
      buffers[dir] += chunk;
      flushLines(dir, false);
    },
    async close() {
      if (!closed) {
        flushLines('out', true);
        flushLines('in', true);
        queueHeader();
        closed = true;
      }
      await chain;
    },
  };
}

/** A sink when `OVERDECK_PROTOCOL_CAPTURE_DIR` names an absolute dir, else undefined. */
export function protocolCaptureFromEnv(
  env: NodeJS.ProcessEnv,
  input: { harness: ProtocolFixtureHeader['harness']; scrub: ScrubContext },
): ProtocolCaptureSink | undefined {
  const dir = env[PROTOCOL_CAPTURE_DIR_ENV];
  if (!dir || !isAbsolute(dir)) return undefined;
  const recordedAt = new Date().toISOString();
  const path = join(dir, `${input.harness}-${recordedAt.replace(/[:.]/g, '-')}-${process.pid}.jsonl`);
  return createProtocolCaptureSink({ path, harness: input.harness, scrub: input.scrub, recordedAt });
}

/** Wrap a Codex app-server transport so every sent and received frame is captured. */
export function captureAppServerTransport(transport: AppServerTransport, sink: ProtocolCaptureSink): AppServerTransport {
  return {
    send(message) {
      sink.recordMessage('out', message);
      transport.send(message);
    },
    onMessage(handler) {
      transport.onMessage(text => {
        sink.recordText('in', text);
        handler(text);
      });
    },
    onClose(handler) {
      transport.onClose(handler);
    },
    close() {
      transport.close();
    },
  };
}
