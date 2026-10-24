import { describe, it, expect, vi } from 'vitest';

import { HerdrTerminalProcess, type HerdrTerminalStreams } from '../../../src/dashboard/server/services/terminal-service.js';
import type { TerminalControl, TerminalFrame, TerminalObservation } from '../../../src/lib/terminal-backends/types.js';

/**
 * PAN-4582 W5. `HerdrTerminalProcess` takes control at attach instead of
 * opening it lazily: only a control attach resizes the PTY, and only control
 * frames follow a later resize. A refused controller falls back to read-only
 * `observe` at the same dims.
 */

/** Push-driven async iterable so a test can deliver frames one at a time. */
class FakeFrameQueue implements AsyncIterable<TerminalFrame> {
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
    while (this.waiters.length) this.waiters.shift()?.({ value: undefined as unknown as TerminalFrame, done: true });
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

interface FakeStream {
  readonly frames: FakeFrameQueue;
  readonly writes: string[];
  readonly resizes: Array<{ cols: number; rows: number }>;
  readonly dims: { cols: number; rows: number };
  closed: boolean;
}

function fakeStreamOpener(): {
  open: (terminalId: string, deps: { cols: number; rows: number }) => TerminalControl & TerminalObservation;
  calls: Array<{ terminalId: string; deps: { cols: number; rows: number } }>;
  streams: FakeStream[];
} {
  const calls: Array<{ terminalId: string; deps: { cols: number; rows: number } }> = [];
  const streams: FakeStream[] = [];
  return {
    calls,
    streams,
    open: (terminalId, deps) => {
      calls.push({ terminalId, deps });
      const frames = new FakeFrameQueue();
      const stream: FakeStream = { frames, writes: [], resizes: [], dims: { ...deps }, closed: false };
      streams.push(stream);
      return {
        frames,
        write: (data: string) => { stream.writes.push(data); },
        resize: (cols: number, rows: number) => { stream.resizes.push({ cols, rows }); },
        close: () => { stream.closed = true; frames.finish(); },
      };
    },
  };
}

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('HerdrTerminalProcess', () => {
  it('opens control with the given dims at construction and never opens observe', async () => {
    const control = fakeStreamOpener();
    const observe = fakeStreamOpener();
    const streams: HerdrTerminalStreams = { control: control.open, observe: observe.open };

    new HerdrTerminalProcess('term_a', 120, 40, streams);
    await wait();

    expect(control.calls).toEqual([{ terminalId: 'term_a', deps: { cols: 120, rows: 40 } }]);
    expect(observe.calls).toEqual([]);
  });

  it('delivers control frames to onData, and forwards write/resize to the controller', async () => {
    const control = fakeStreamOpener();
    const observe = fakeStreamOpener();
    const bridge = new HerdrTerminalProcess('term_b', 80, 24, { control: control.open, observe: observe.open });

    const seen: string[] = [];
    bridge.onData((data) => seen.push(data));

    control.streams[0].frames.push({ kind: 'snapshot', cols: 80, rows: 24, data: 'hello' });
    await wait();
    expect(seen).toEqual(['hello']);

    bridge.write('echo hi\r');
    bridge.resize(100, 30);
    expect(control.streams[0].writes).toEqual(['echo hi\r']);
    expect(control.streams[0].resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('falls back to a read-only observe stream when control is refused before any frame', async () => {
    const control = fakeStreamOpener();
    const observe = fakeStreamOpener();
    const bridge = new HerdrTerminalProcess('term_c', 80, 24, { control: control.open, observe: observe.open });

    control.streams[0].frames.push({ kind: 'exit', code: null });
    await wait();

    expect(observe.calls).toEqual([{ terminalId: 'term_c', deps: { cols: 80, rows: 24 } }]);

    const seen: string[] = [];
    bridge.onData((data) => seen.push(data));
    observe.streams[0].frames.push({ kind: 'output', data: 'read only' });
    await wait();
    expect(seen).toEqual(['read only']);

    bridge.write('ignored');
    bridge.resize(100, 30);
    expect(control.streams[0].writes).toEqual([]);
    expect(control.streams[0].resizes).toEqual([]);
  });

  it('closes cleanly before any frame: never opens observe, and emits exit exactly once', async () => {
    const control = fakeStreamOpener();
    const observe = fakeStreamOpener();
    const bridge = new HerdrTerminalProcess('term_d', 80, 24, { control: control.open, observe: observe.open });

    const exitCodes: number[] = [];
    bridge.onExit((code) => exitCodes.push(code));

    bridge.close();
    expect(control.streams[0].closed).toBe(true);

    // The control stream ending AFTER close() must not retrigger the fallback or a second exit.
    control.streams[0].frames.push({ kind: 'exit', code: null });
    await wait();

    expect(observe.calls).toEqual([]);
    expect(exitCodes).toEqual([0]);
  });

  it('emits exit without opening observe when the control stream ends after delivering frames', async () => {
    const control = fakeStreamOpener();
    const observe = fakeStreamOpener();
    const bridge = new HerdrTerminalProcess('term_e', 80, 24, { control: control.open, observe: observe.open });

    const exitCodes: number[] = [];
    bridge.onExit((code) => exitCodes.push(code));

    control.streams[0].frames.push({ kind: 'snapshot', cols: 80, rows: 24, data: 'hello' });
    await wait();
    control.streams[0].frames.push({ kind: 'exit', code: 7 });
    await wait();

    expect(observe.calls).toEqual([]);
    expect(exitCodes).toEqual([7]);
  });

  it('logs the read-only fallback exactly once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const control = fakeStreamOpener();
    const observe = fakeStreamOpener();
    new HerdrTerminalProcess('term_f', 80, 24, { control: control.open, observe: observe.open });

    control.streams[0].frames.push({ kind: 'exit', code: null });
    await wait();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('term_f');
    warn.mockRestore();
  });
});
