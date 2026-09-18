/**
 * Herdr terminal streams (PAN-3917 FR-4, W8).
 *
 * `herdr --session <s> terminal session observe <terminalId>` writes NDJSON
 * records to stdout; `… terminal session control <terminalId>` does the same
 * and additionally reads NDJSON control commands from stdin. Verified live
 * against herdr v0.9.1 on 2026-09-18:
 *
 *   {"type":"terminal.frame","bytes":"<base64>","encoding":"ansi",
 *    "full":true,"width":100,"height":30,"seq":1}   ← first frame, a snapshot
 *   {"type":"terminal.frame","bytes":"…","full":false,…}  ← incremental output
 *   {"type":"terminal.closed"}                            ← orderly end
 *
 * and, on stdin of `control`:
 *
 *   {"type":"terminal.resize","cols":100,"rows":30}
 *   {"type":"terminal.input","text":"echo hi\r"}     (or "bytes": base64 — not both)
 *
 * Many observers may attach to one terminal; one controller may. A stream that
 * ends WITHOUT a `terminal.closed` record (the process is killed, the socket
 * dies) still has to close the dashboard's WebSocket, so EOF synthesizes an
 * `exit` frame — the decoder never leaves a viewer hanging on a half-closed
 * stream.
 */

import { spawn as nodeSpawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';

import { HERDR_SESSION_NAME, HERDR_BINARY } from './select.js';
import type { TerminalControl, TerminalFrame, TerminalObservation } from './types.js';

/** One decoded NDJSON record from a terminal stream. */
export interface HerdrTerminalRecord {
  readonly type?: string;
  readonly bytes?: string;
  readonly text?: string;
  readonly encoding?: string;
  readonly full?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly seq?: number;
  readonly code?: number | null;
}

/** Size carried forward so an incremental frame can report a resize. */
export interface TerminalDecodeState {
  cols: number;
  rows: number;
}

/**
 * Decode one record into the contract's frames. A full frame is a snapshot; an
 * incremental frame is output, preceded by a `size` frame when the geometry
 * changed since the last record.
 */
export function decodeTerminalRecord(
  record: HerdrTerminalRecord,
  state: TerminalDecodeState,
): TerminalFrame[] {
  if (record.type === 'terminal.closed' || record.type === 'terminal.exited') {
    return [{ kind: 'exit', code: record.code ?? null }];
  }
  if (record.type !== 'terminal.frame') return [];

  const data = record.bytes !== undefined
    ? Buffer.from(record.bytes, 'base64').toString('binary')
    : record.text ?? '';
  const cols = record.width ?? state.cols;
  const rows = record.height ?? state.rows;

  if (record.full) {
    state.cols = cols;
    state.rows = rows;
    return [{ kind: 'snapshot', cols, rows, data }];
  }

  const frames: TerminalFrame[] = [];
  if (cols !== state.cols || rows !== state.rows) {
    state.cols = cols;
    state.rows = rows;
    frames.push({ kind: 'size', cols, rows });
  }
  frames.push({ kind: 'output', data });
  return frames;
}

/** Minimal spawn shape so tests can drive the decoder without a real process. */
export type HerdrSpawn = (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams;

export interface HerdrStreamDeps {
  readonly spawn?: HerdrSpawn;
  readonly binary?: string;
  readonly session?: string;
  readonly cols?: number;
  readonly rows?: number;
}

function streamArgs(
  mode: 'observe' | 'control',
  terminalId: string,
  deps: HerdrStreamDeps,
): { command: string; args: string[] } {
  const args = ['--session', deps.session ?? HERDR_SESSION_NAME, 'terminal', 'session', mode, terminalId];
  if (deps.cols) args.push('--cols', String(deps.cols));
  if (deps.rows) args.push('--rows', String(deps.rows));
  return { command: deps.binary ?? HERDR_BINARY, args };
}

/** Push-driven async iterable: frames arrive from the child, consumers await them. */
class FrameQueue implements AsyncIterable<TerminalFrame> {
  private readonly pending: TerminalFrame[] = [];
  private readonly waiters: Array<(result: IteratorResult<TerminalFrame>) => void> = [];
  private done = false;

  push(frame: TerminalFrame): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: frame, done: false });
    else this.pending.push(frame);
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    while (this.waiters.length) {
      this.waiters.shift()?.({ value: undefined as unknown as TerminalFrame, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<TerminalFrame> {
    return {
      next: async (): Promise<IteratorResult<TerminalFrame>> => {
        const buffered = this.pending.shift();
        if (buffered) return { value: buffered, done: false };
        if (this.done) return { value: undefined as unknown as TerminalFrame, done: true };
        return await new Promise<IteratorResult<TerminalFrame>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

interface StreamChild {
  readonly child: ChildProcessWithoutNullStreams;
  readonly frames: FrameQueue;
  close(): void;
}

function startStream(
  mode: 'observe' | 'control',
  terminalId: string,
  deps: HerdrStreamDeps,
): StreamChild {
  const { command, args } = streamArgs(mode, terminalId, deps);
  const spawnFn = deps.spawn ?? ((cmd, argv) => nodeSpawn(cmd, [...argv]) as ChildProcessWithoutNullStreams);
  const child = spawnFn(command, args);
  const frames = new FrameQueue();
  const state: TerminalDecodeState = { cols: deps.cols ?? 80, rows: deps.rows ?? 24 };
  let buffer = '';
  let sawExit = false;

  child.stdout?.setEncoding?.('utf-8');
  child.stdout?.on('data', (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
      if (!line.trim()) continue;
      let record: HerdrTerminalRecord;
      try {
        record = JSON.parse(line) as HerdrTerminalRecord;
      } catch {
        continue; // A corrupt line must not tear down a live terminal.
      }
      for (const frame of decodeTerminalRecord(record, state)) {
        if (frame.kind === 'exit') sawExit = true;
        frames.push(frame);
      }
    }
  });

  const endOfStream = (code: number | null): void => {
    // EOF with no `terminal.closed` record still has to close the viewer.
    if (!sawExit) {
      sawExit = true;
      frames.push({ kind: 'exit', code });
    }
    frames.finish();
  };

  child.on('close', (code: number | null) => endOfStream(code));
  child.on('error', () => endOfStream(null));

  return {
    child,
    frames,
    close: () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      endOfStream(null);
    },
  };
}

/** Read-only attachment. Many may be open on one terminal at once. */
export function observeTerminal(terminalId: string, deps: HerdrStreamDeps = {}): TerminalObservation {
  const stream = startStream('observe', terminalId, deps);
  return { frames: stream.frames, close: stream.close };
}

/** Write attachment. Herdr allows one controller per terminal. */
export function controlTerminal(terminalId: string, deps: HerdrStreamDeps = {}): TerminalControl {
  const stream = startStream('control', terminalId, deps);
  const send = (command: Record<string, unknown>): void => {
    try {
      stream.child.stdin?.write(`${JSON.stringify(command)}\n`);
    } catch {
      /* the controller died; the observe stream reports the exit */
    }
  };
  return {
    write: (data: string) => send({ type: 'terminal.input', text: data }),
    resize: (cols: number, rows: number) => send({ type: 'terminal.resize', cols, rows }),
    close: stream.close,
  };
}
