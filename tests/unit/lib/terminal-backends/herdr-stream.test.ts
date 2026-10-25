import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { homedir } from 'os';
import { delimiter, join } from 'path';

import {
  controlTerminal,
  decodeTerminalRecord,
  observeTerminal,
  sizeHerdrTerminal,
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

/** A terminal.frame record built from explicit raw bytes, for UTF-8 decode fixtures. */
const frame = (bytes: number[], full = false) => ({
  type: 'terminal.frame',
  bytes: Buffer.from(bytes).toString('base64'),
  encoding: 'ansi',
  full,
  width: 100,
  height: 30,
});

/** A child process stand-in whose stdout the test drives line by line. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter() as EventEmitter & { setEncoding(enc: string): void };
  readonly stdin: { write(data: string): boolean } & { writes: string[] };
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;

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

  // Mirrors Node's real child_process semantics: `exitCode`/`signalCode` are
  // set just before a 'close' listener runs, never both left null.
  emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'close') {
      const [code, signal] = args as [number | null, string | null];
      this.exitCode = code ?? null;
      this.signalCode = signal ?? (code === null ? 'SIGTERM' : null);
    }
    return super.emit(event, ...args);
  }
}

type SpawnOptions = { env: NodeJS.ProcessEnv };

function fakeSpawn(): {
  spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;
  children: FakeChild[];
  calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }>;
} {
  const children: FakeChild[] = [];
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
  return {
    children,
    calls,
    spawn: (command: string, args: readonly string[], options: SpawnOptions) => {
      calls.push({ command, args, options });
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

  it('decodes a 3-byte character split across two incremental frames', () => {
    const state: TerminalDecodeState = { cols: 100, rows: 30 };
    expect(decodeTerminalRecord(frame([0xe2]), state)).toEqual([]);
    expect(decodeTerminalRecord(frame([0x97, 0x8f]), state)).toEqual([
      { kind: 'output', data: '●' },
    ]);
  });

  it('starts a fresh decoder on a snapshot frame', () => {
    const state: TerminalDecodeState = { cols: 100, rows: 30 };
    expect(decodeTerminalRecord(frame([0xe2]), state)).toEqual([]);
    expect(decodeTerminalRecord(frame([...Buffer.from('hello')], true), state)).toEqual([
      { kind: 'snapshot', cols: 100, rows: 30, data: 'hello' },
    ]);
    expect(decodeTerminalRecord(frame([0xe2, 0x97, 0x8f]), state)).toEqual([
      { kind: 'output', data: '●' },
    ]);
  });

  it('decodes multi-byte characters and emoji in one frame', () => {
    const state: TerminalDecodeState = { cols: 100, rows: 30 };
    const text = '● · ─ ⎿ 🚀';
    expect(decodeTerminalRecord(frame([...Buffer.from(text, 'utf-8')]), state)).toEqual([
      { kind: 'output', data: text },
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

  it('keeps one decoder per stream', async () => {
    const { spawn, children } = fakeSpawn();
    const first = observeTerminal('term_f', { spawn });
    const second = observeTerminal('term_f', { spawn });
    expect(children).toHaveLength(2);

    children[0].emitRecord(FULL_FRAME);
    children[1].emitRecord(FULL_FRAME);
    children[0].emitRecord(frame([0xe2]));
    children[1].emitRecord(frame([0x97, 0x8f]));
    children[0].emitRecord(frame([0x97, 0x8f]));

    const [firstFrames, secondFrames] = await Promise.all([
      collect(first.frames, 2),
      collect(second.frames, 2),
    ]);
    expect(firstFrames[1]).toEqual({ kind: 'output', data: '●' });
    expect(secondFrames[1]).toEqual({ kind: 'output', data: '��' });

    first.close();
    second.close();
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

  it('spawns herdr with ~/.local/bin on PATH when the dashboard PATH omits it', () => {
    vi.stubEnv('PATH', '/usr/bin:/bin');
    try {
      const { spawn, calls } = fakeSpawn();
      controlTerminal('term_l', { spawn }).close();
      observeTerminal('term_l', { spawn }).close();
      for (const call of calls) {
        expect(call.command).toBe('herdr');
        expect(call.options.env.PATH).toBe(['/usr/bin', '/bin', join(homedir(), '.local', 'bin')].join(delimiter));
      }
      expect(calls).toHaveLength(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('exposes the control stream as frames', async () => {
    const { spawn, children } = fakeSpawn();
    const control = controlTerminal('term_g', { spawn });
    const pending = collect(control.frames, 1);
    children[0].emitRecord({
      type: 'terminal.frame',
      bytes: Buffer.from('hello', 'binary').toString('base64'),
      encoding: 'ansi',
      full: true,
      width: 80,
      height: 20,
      seq: 1,
    });
    expect((await pending)[0]).toEqual({ kind: 'snapshot', cols: 80, rows: 20, data: 'hello' });
  });
});

describe('sizeHerdrTerminal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves sized on a first frame, attaching with the requested size', async () => {
    const { spawn, children, calls } = fakeSpawn();
    const pending = sizeHerdrTerminal('term_h', 120, 40, { spawn });
    children[0].emitRecord(FULL_FRAME);
    children[0].emit('close', 0);

    await expect(pending).resolves.toBe('sized');
    expect(calls[0].args).toEqual(
      expect.arrayContaining(['control', 'term_h', '--cols', '120', '--rows', '40']),
    );
  });

  it('resolves refused when the child closes before any frame', async () => {
    const { spawn, children } = fakeSpawn();
    const pending = sizeHerdrTerminal('term_i', 120, 40, { spawn });
    children[0].emit('close', 0);

    await expect(pending).resolves.toBe('refused');
  });

  it('resolves timeout and kills the child when neither a frame nor a close arrives', async () => {
    const { spawn, children } = fakeSpawn();
    const pending = sizeHerdrTerminal('term_j', 120, 40, { spawn });
    await vi.advanceTimersByTimeAsync(3000);
    expect(children[0].killed).toBe(true);
    children[0].emit('close', null);

    await expect(pending).resolves.toBe('timeout');
  });

  it('stays pending after a frame arrives until the child actually closes', async () => {
    const { spawn, children } = fakeSpawn();
    const pending = sizeHerdrTerminal('term_k', 120, 40, { spawn });
    children[0].emitRecord(FULL_FRAME);

    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    children[0].emit('close', 0);
    await expect(pending).resolves.toBe('sized');
    expect(settled).toBe(true);
  });
});
