/**
 * Protocol capture fixture format `overdeck-protocol-capture/1` (PAN-4563).
 *
 * A fixture is one JSONL file: a header line, then one line per JSON-RPC frame
 * in observed order. Capture writes it (capture.ts), the replay engine plays it
 * back to the real client code, and the hygiene test checks every committed
 * fixture. See docs/PROTOCOL-REPLAY-TESTS.md.
 */
import { readFile } from 'node:fs/promises';

export const PROTOCOL_CAPTURE_FORMAT = 'overdeck-protocol-capture/1';

export type FrameDirection = 'out' | 'in';
const FIXTURE_HARNESSES: ReadonlySet<unknown> = new Set(['codex-app-server', 'acp']);
export type FrameKind = 'request' | 'notification' | 'response' | 'raw';

export interface ProtocolFixtureHeader {
  type: 'header';
  format: typeof PROTOCOL_CAPTURE_FORMAT;
  harness: 'codex-app-server' | 'acp';
  provider: string | null;
  cliVersion: string | null;
  scenario: string | null;
  recordedAt: string;
  hostOptions: Record<string, unknown> | null;
  scrubbed: true;
  synthetic?: true;
  syntheticNote?: string;
  followUpIssue?: string;
  /** Free-text provenance from the recorder's --note, e.g. a non-default model backend. */
  note?: string;
}

export interface ProtocolFrame {
  type: 'frame';
  seq: number;
  dir: FrameDirection;
  /** Milliseconds since capture start. Diagnostic only; replay ignores it. */
  t: number;
  message?: Record<string, unknown>;
  /** A line that was not valid JSON, kept verbatim. */
  text?: string;
}

export interface ProtocolFixture {
  header: ProtocolFixtureHeader;
  frames: ProtocolFrame[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * request = `id` and `method`; notification = `method` and no `id`;
 * response = `id` and no `method`; raw = a text frame or a message with neither.
 */
export function frameKind(frame: ProtocolFrame): FrameKind {
  const message = frame.message;
  if (!message) return 'raw';
  const hasId = Object.hasOwn(message, 'id');
  const hasMethod = typeof message.method === 'string';
  if (hasMethod) return hasId ? 'request' : 'notification';
  return hasId ? 'response' : 'raw';
}

function parseLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`protocol fixture line ${lineNumber}: invalid JSON (${(error as Error).message})`);
  }
}

/** Parse fixture text. Throws on a missing or foreign header, a non-frame line, or non-consecutive seq. */
export function parseProtocolFixture(text: string): ProtocolFixture {
  const lines = text.split('\n');
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  if (lines.length === 0) throw new Error('protocol fixture is empty: line 1 must be a header');

  const header = parseLine(lines[0]!, 1);
  if (!isRecord(header) || header.type !== 'header' || header.format !== PROTOCOL_CAPTURE_FORMAT) {
    throw new Error(`protocol fixture line 1 must be a header with format ${PROTOCOL_CAPTURE_FORMAT}`);
  }
  if (!FIXTURE_HARNESSES.has(header.harness)) {
    throw new Error(`protocol fixture header has unknown harness ${JSON.stringify(header.harness)}`);
  }

  const frames: ProtocolFrame[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const frame = parseLine(lines[index]!, lineNumber);
    if (!isRecord(frame) || frame.type !== 'frame') {
      throw new Error(`protocol fixture line ${lineNumber} is not a frame`);
    }
    if (frame.seq !== frames.length) {
      throw new Error(`protocol fixture line ${lineNumber}: expected seq ${frames.length}, got ${JSON.stringify(frame.seq)}`);
    }
    if (frame.dir !== 'out' && frame.dir !== 'in') {
      throw new Error(`protocol fixture line ${lineNumber}: dir must be "out" or "in"`);
    }
    if (!isRecord(frame.message) && typeof frame.text !== 'string') {
      throw new Error(`protocol fixture line ${lineNumber}: frame needs a message object or a text string`);
    }
    frames.push(frame as unknown as ProtocolFrame);
  }
  return { header: header as unknown as ProtocolFixtureHeader, frames };
}

export async function loadProtocolFixture(path: string): Promise<ProtocolFixture> {
  return parseProtocolFixture(await readFile(path, 'utf8'));
}
