import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcessWithoutNullStreams } from 'child_process';

import {
  controlTerminal,
  decodeTerminalRecord,
  observeTerminal,
  type TerminalDecodeState,
} from '../../../../src/lib/terminal-backends/herdr-stream.js';
import type { TerminalFrame } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3917 W8. Records recorded from herdr v0.9.1 on 2026-09-18:
 * `terminal.frame` (full, then incremental) and `terminal.closed`. Many
 * observers may attach to one terminal; one controller may. A stream that ends
 * without a close record still has to close the viewer.
 */

const FULL_FRAME = {
  type: 'terminal.frame',
  bytes: Buffer.from('[2Jhello', 'binary').toString('base64'),
  encoding: 'ansi',
  full: true,
  width: 100,
  height: 30,
  seq: 1,
};

const INCREMENTAL_FRAME = {
  type: 'terminal.frame',
  bytes: Buffer.from(' world', 'binary').toString('base64'),
  encoding: 'ansi',
  full: false,
  width: 100,
  height: 30,
  seq: 2,
};

/** A child process stand-in whose stdout the test drives line by line. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter() as EventEmitter & { setEncoding(enc: string): void };
  readonly stdin: { write(data: string): boolean } & { writes: string[] };
  killed = false;

  constructor() {
    super();
    (this.stdout as unknown as { setEncoding(enc: string): void }).setEncoding = () => {};
    const writes: string[] = [];
    this.stdin = Object.assign({ write: (data: string) => { writes.push(data); return true; } }, { writes });
  }

  emitRecord(record: unknown): void {
    this.stdout.emit('data', `${JSON.stringify(record)}\n`);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function fakeSpawn(): { spawn: () => ChildProcessWithoutNullStreams; children: FakeChild[] } {
  const children: FakeChild[] = [];
  return {
    children,
    spawn: () => {
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  };
}

async function collect(frames: AsyncIterable<TerminalFrame>, count: number): Promise<TerminalFrame[]> {
  const out: TerminalFrame[] = [];
  for await (const frame of frames) {
    out.push(frame);
    if (out.length === count) break;
  }
  return out;
}

describe('decodeTerminalRecord', () => {
  it('maps a full frame to a snapshot and an incremental frame to output', () => {
    const state: TerminalDecodeState = { cols: 80, rows: 24 };
    expect(decodeTerminalRecord(FULL_FRAME, state)).toEqual([
      { kind: 'snapshot', cols: 100, rows: 30, data: '[2Jhello' },
    ]);
    expect(decodeTerminalRecord(INCREMENTAL_FRAME, state)).toEqual([{ kind: 'output', data: ' world' }]);
  });

  it('emits a size frame when the geometry changes mid-stream', () => {
    const state: TerminalDecodeState = { cols: 100, rows: 30 };
    const frames = decodeTerminalRecord({ ...INCREMENTAL_FRAME, width: 120, height: 40 }, state);
    expect(frames[0]).toEqual({ kind: 'size', cols: 120, rows: 40 });
    expect(frames[1]).toMatchObject({ kind: 'output' });
  });

  it('maps terminal.closed to an exit frame', () => {
    expect(decodeTerminalRecord({ type: 'terminal.closed' }, { cols: 80, rows: 24 })).toEqual([
      { kind: 'exit', code: null },
    ]);
  });
});

describe('observeTerminal', () => {
  it('serves two observers from two independent streams', async () => {
    const { spawn, children } = fakeSpawn();
    const first = observeTerminal('term_a', { spawn });
    const second = observeTerminal('term_a', { spawn });
    expect(children).toHaveLength(2);

    children[0].emitRecord(FULL_FRAME);
    children[1].emitRecord(FULL_FRAME);

    const [firstFrames, secondFrames] = await Promise.all([
      collect(first.frames, 1),
      collect(second.frames, 1),
    ]);
    expect(firstFrames[0]).toMatchObject({ kind: 'snapshot', cols: 100 });
    expect(secondFrames[0]).toMatchObject({ kind: 'snapshot', cols: 100 });

    first.close();
    second.close();
    expect(children.every((child) => child.killed)).toBe(true);
  });

  it('synthesizes an exit frame on EOF without a close record', async () => {
    const { spawn, children } = fakeSpawn();
    const observation = observeTerminal('term_b', { spawn });
    const pending = collect(observation.frames, 2);
    children[0].emitRecord(FULL_FRAME);
    children[0].emit('close', 137);

    const frames = await pending;
    expect(frames[1]).toEqual({ kind: 'exit', code: 137 });
  });

  it('ignores a corrupt line instead of tearing the terminal down', async () => {
    const { spawn, children } = fakeSpawn();
    const observation = observeTerminal('term_c', { spawn });
    const pending = collect(observation.frames, 1);
    children[0].stdout.emit('data', '{not json}\n');
    children[0].emitRecord(FULL_FRAME);
    expect((await pending)[0]).toMatchObject({ kind: 'snapshot' });
  });
});

describe('controlTerminal', () => {
  it('writes input and resize commands as NDJSON on stdin', () => {
    const { spawn, children } = fakeSpawn();
    const control = controlTerminal('term_d', { spawn });
    control.write('echo hi\r');
    control.resize(120, 40);

    const written = (children[0].stdin as unknown as { writes: string[] }).writes.map((line) => JSON.parse(line));
    expect(written[0]).toEqual({ type: 'terminal.input', text: 'echo hi\r' });
    expect(written[1]).toEqual({ type: 'terminal.resize', cols: 120, rows: 40 });
  });

  it('spawns exactly one controller per call and kills it on close', () => {
    const { spawn, children } = fakeSpawn();
    const control = controlTerminal('term_e', { spawn, session: 'overdeck' });
    expect(children).toHaveLength(1);
    control.close();
    expect(children[0].killed).toBe(true);
  });
});
