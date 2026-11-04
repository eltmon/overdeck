import type { TerminalPayload } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { TerminalFrame, TerminalObservation } from '../../../../lib/terminal-backends/types.js';
import {
  TerminalBridge,
  terminalPayloadOf,
  type TerminalBridgeDeps,
  type TerminalSink,
  type TerminalTarget,
} from '../terminal-bridge.js';

/** A TerminalObservation whose frames the test pushes; close() ends the stream. */
function makeObservation() {
  const queue: TerminalFrame[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  const close = vi.fn(() => {
    ended = true;
    wake?.();
  });
  const frames: AsyncIterable<TerminalFrame> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queue.length > 0) yield queue.shift()!;
        if (ended) return;
        await new Promise<void>((resolve) => { wake = resolve; });
        wake = null;
      }
    },
  };
  return {
    frames,
    close,
    push(frame: TerminalFrame) {
      queue.push(frame);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
  } satisfies TerminalObservation & Record<string, unknown>;
}

function makeSink(): TerminalSink & { payloads: TerminalPayload[] } {
  const payloads: TerminalPayload[] = [];
  return { payloads, send: (payload) => { payloads.push(payload); } };
}

/** Lets the bridge's pump loop drain everything pushed so far. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function herdrDeps(observations: Array<ReturnType<typeof makeObservation>>): TerminalBridgeDeps & {
  observeHerdr: ReturnType<typeof vi.fn>;
} {
  return {
    resolveTarget: async () => ({ kind: 'herdr', terminalId: 'term_1' }),
    observeHerdr: vi.fn(() => {
      const observation = makeObservation();
      observations.push(observation);
      return observation;
    }),
    subscribeTmux: vi.fn(async () => null),
  };
}

const snapshot: TerminalFrame = { kind: 'snapshot', cols: 120, rows: 40, data: 'SCREEN' };

describe('terminalPayloadOf', () => {
  it('maps exit to terminal_ended after a snapshot and terminal_not_found before', () => {
    expect(terminalPayloadOf({ kind: 'exit', code: 0 }, true)).toEqual({ kind: 'unavailable', reason: 'terminal_ended' });
    expect(terminalPayloadOf({ kind: 'exit', code: null }, false)).toEqual({ kind: 'unavailable', reason: 'terminal_not_found' });
  });
});

describe('TerminalBridge', () => {
  it('sends terminal_not_found for a conversation with no terminal', async () => {
    const deps = herdrDeps([]);
    deps.resolveTarget = async () => ({ kind: 'missing' });
    const sink = makeSink();

    await new TerminalBridge('conv', deps).attach(sink);

    expect(sink.payloads).toEqual([{ kind: 'unavailable', reason: 'terminal_not_found' }]);
    expect(deps.observeHerdr).not.toHaveBeenCalled();
  });

  it('sends terminal_not_found when the resolver throws', async () => {
    const deps = herdrDeps([]);
    deps.resolveTarget = async () => { throw new Error('db down'); };
    const sink = makeSink();

    await new TerminalBridge('conv', deps).attach(sink);

    expect(sink.payloads).toEqual([{ kind: 'unavailable', reason: 'terminal_not_found' }]);
  });

  it('streams Herdr snapshot, output and size in order', async () => {
    const observations: Array<ReturnType<typeof makeObservation>> = [];
    const sink = makeSink();
    await new TerminalBridge('conv', herdrDeps(observations)).attach(sink);

    observations[0]!.push(snapshot);
    observations[0]!.push({ kind: 'output', data: 'abc' });
    observations[0]!.push({ kind: 'size', cols: 100, rows: 30 });
    await settle();

    expect(sink.payloads).toEqual([
      { kind: 'snapshot', cols: 120, rows: 40, data: 'SCREEN' },
      { kind: 'output', data: 'abc' },
      { kind: 'size', cols: 100, rows: 30 },
    ]);
  });

  it('sends terminal_ended when the Herdr terminal exits after its snapshot', async () => {
    const observations: Array<ReturnType<typeof makeObservation>> = [];
    const sink = makeSink();
    await new TerminalBridge('conv', herdrDeps(observations)).attach(sink);

    observations[0]!.push(snapshot);
    observations[0]!.push({ kind: 'exit', code: 0 });
    await settle();

    expect(sink.payloads.at(-1)).toEqual({ kind: 'unavailable', reason: 'terminal_ended' });
    expect(observations[0]!.close).toHaveBeenCalled();
  });

  it('sends terminal_not_found when the Herdr stream ends before any snapshot', async () => {
    const observations: Array<ReturnType<typeof makeObservation>> = [];
    const sink = makeSink();
    await new TerminalBridge('conv', herdrDeps(observations)).attach(sink);

    observations[0]!.end();
    await settle();

    expect(sink.payloads).toEqual([{ kind: 'unavailable', reason: 'terminal_not_found' }]);
  });

  it('detach closes the observation and later frames are not delivered', async () => {
    const observations: Array<ReturnType<typeof makeObservation>> = [];
    const sink = makeSink();
    const detach = await new TerminalBridge('conv', herdrDeps(observations)).attach(sink);
    observations[0]!.push(snapshot);
    await settle();

    detach();
    detach();
    observations[0]!.push({ kind: 'output', data: 'late' });
    await settle();

    expect(observations[0]!.close).toHaveBeenCalledTimes(1);
    expect(sink.payloads).toEqual([{ kind: 'snapshot', cols: 120, rows: 40, data: 'SCREEN' }]);
  });

  it('opens one observation per attach', async () => {
    const observations: Array<ReturnType<typeof makeObservation>> = [];
    const deps = herdrDeps(observations);
    const bridge = new TerminalBridge('conv', deps);

    await bridge.attach(makeSink());
    await bridge.attach(makeSink());

    expect(deps.observeHerdr).toHaveBeenCalledTimes(2);
  });

  it('close() closes every observation and a later attach sends nothing', async () => {
    const observations: Array<ReturnType<typeof makeObservation>> = [];
    const deps = herdrDeps(observations);
    const bridge = new TerminalBridge('conv', deps);
    await bridge.attach(makeSink());
    await bridge.attach(makeSink());

    bridge.close();
    const late = makeSink();
    await bridge.attach(late);

    expect(observations[0]!.close).toHaveBeenCalledTimes(1);
    expect(observations[1]!.close).toHaveBeenCalledTimes(1);
    expect(deps.observeHerdr).toHaveBeenCalledTimes(2);
    expect(late.payloads).toEqual([]);
  });

  it('two attaches each detach their own observation, then close() and a later attach send nothing', async () => {
    const observations: Array<ReturnType<typeof makeObservation>> = [];
    const deps = herdrDeps(observations);
    const bridge = new TerminalBridge('conv', deps);
    const first = makeSink();
    const second = makeSink();
    const detachFirst = await bridge.attach(first);
    const detachSecond = await bridge.attach(second);

    detachFirst();
    detachSecond();
    bridge.close();
    observations[0]!.push(snapshot);
    observations[1]!.push(snapshot);
    await settle();
    const late = makeSink();
    await bridge.attach(late);

    expect(deps.observeHerdr).toHaveBeenCalledTimes(2);
    expect(observations[0]!.close).toHaveBeenCalledTimes(1);
    expect(observations[1]!.close).toHaveBeenCalledTimes(1);
    expect(first.payloads).toEqual([]);
    expect(second.payloads).toEqual([]);
    expect(late.payloads).toEqual([]);
  });

  it('detaches a sink whose send throws', async () => {
    const observations: Array<ReturnType<typeof makeObservation>> = [];
    const sink: TerminalSink = { send: vi.fn(() => { throw new Error('closed'); }) };
    await new TerminalBridge('conv', herdrDeps(observations)).attach(sink);

    observations[0]!.push(snapshot);
    observations[0]!.push({ kind: 'output', data: 'x' });
    await settle();

    expect(sink.send).toHaveBeenCalledTimes(1);
    expect(observations[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when detached while the target is still resolving', async () => {
    const deps = herdrDeps([]);
    let resolveTarget: (target: TerminalTarget) => void = () => {};
    deps.resolveTarget = () => new Promise((resolve) => { resolveTarget = resolve; });
    const bridge = new TerminalBridge('conv', deps);
    const sink = makeSink();

    const attaching = bridge.attach(sink);
    bridge.close();
    resolveTarget({ kind: 'herdr', terminalId: 'term_1' });
    await attaching;

    expect(deps.observeHerdr).not.toHaveBeenCalled();
    expect(sink.payloads).toEqual([]);
  });

  describe('tmux', () => {
    function tmuxDeps(subscribe: TerminalBridgeDeps['subscribeTmux']): TerminalBridgeDeps {
      return {
        resolveTarget: async () => ({ kind: 'tmux', sessionName: 'conv-a' }),
        observeHerdr: vi.fn(),
        subscribeTmux: subscribe,
      };
    }

    it('sends terminal_not_found when the hub subscription finds no session', async () => {
      const sink = makeSink();

      await new TerminalBridge('conv', tmuxDeps(async () => null)).attach(sink);

      expect(sink.payloads).toEqual([{ kind: 'unavailable', reason: 'terminal_not_found' }]);
    });

    it('maps hub frames the same way and detach closes the subscription', async () => {
      let emit: (frame: TerminalFrame) => void = () => {};
      const subscription = { close: vi.fn() };
      const subscribe = vi.fn(async (_name: string, onFrame: (frame: TerminalFrame) => void) => {
        emit = onFrame;
        return subscription;
      });
      const sink = makeSink();
      const detach = await new TerminalBridge('conv', tmuxDeps(subscribe)).attach(sink);

      emit(snapshot);
      emit({ kind: 'output', data: 'abc' });
      emit({ kind: 'size', cols: 90, rows: 20 });
      detach();
      emit({ kind: 'output', data: 'late' });

      expect(subscribe).toHaveBeenCalledWith('conv-a', expect.any(Function));
      expect(sink.payloads).toEqual([
        { kind: 'snapshot', cols: 120, rows: 40, data: 'SCREEN' },
        { kind: 'output', data: 'abc' },
        { kind: 'size', cols: 90, rows: 20 },
      ]);
      expect(subscription.close).toHaveBeenCalledTimes(1);
    });

    it('sends terminal_ended when the hub PTY exits after the snapshot', async () => {
      let emit: (frame: TerminalFrame) => void = () => {};
      const sink = makeSink();
      await new TerminalBridge('conv', tmuxDeps(async (_name, onFrame) => {
        emit = onFrame;
        return { close: vi.fn() };
      })).attach(sink);

      emit(snapshot);
      emit({ kind: 'exit', code: null });

      expect(sink.payloads.at(-1)).toEqual({ kind: 'unavailable', reason: 'terminal_ended' });
    });

    it('closes a subscription that opens after the sink detached', async () => {
      let finish: (sub: { close(): void }) => void = () => {};
      const subscription = { close: vi.fn() };
      const bridge = new TerminalBridge('conv', tmuxDeps(() => new Promise((resolve) => { finish = resolve; })));
      const sink = makeSink();

      const attaching = bridge.attach(sink);
      await settle();
      bridge.close();
      finish(subscription);
      await attaching;

      expect(subscription.close).toHaveBeenCalledTimes(1);
      expect(sink.payloads).toEqual([]);
    });
  });
});
