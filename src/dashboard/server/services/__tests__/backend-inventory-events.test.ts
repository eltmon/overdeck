/**
 * The pane event stream re-opens with backoff when Herdr is not up at
 * dashboard boot or the stream drops (PAN-3956 review finding 8).
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendAgentSnapshot } from '@overdeck/contracts';

import {
  EVENT_STREAM_OPEN_TIMEOUT_MS,
  EVENT_STREAM_RETRY_MAX_MS,
  EVENT_STREAM_STABLE_MS,
  _resetBackendInventoryForTests,
  onBackendPanesChanged,
  startBackendInventory,
  stopBackendInventory,
  type BackendPaneDelta,
} from '../backend-inventory.js';
import {
  unsupported,
  type BackendEvent,
  type BackendEventStream,
  type TerminalBackend,
} from '../../../../lib/terminal-backends/types.js';

const SNAPSHOT: readonly BackendAgentSnapshot[] = [
  {
    backend: 'herdr',
    paneId: 'w1:p1',
    terminalId: 'term-w1p1',
    workspaceId: 'w1',
    state: 'working',
    tokens: { issue: 'PAN-3917', role: 'work', harness: 'claude-code', model: 'claude-opus-5' },
  },
];

/** An event stream the test feeds and ends by hand. */
function controlledStream() {
  const queue: BackendEvent[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  const notify = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };
  const stream: BackendEventStream = {
    events: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          if (done) return;
          await new Promise<void>((resolve) => { wake = resolve; });
        }
      },
    },
    close: vi.fn(() => {
      done = true;
      notify();
    }),
  };
  return {
    stream,
    push(event: BackendEvent) {
      queue.push(event);
      notify();
    },
    end() {
      done = true;
      notify();
    },
  };
}

type EventsResult = ReturnType<TerminalBackend['events']>;

function backendWith(events: () => EventsResult) {
  const list = vi.fn(() => Effect.succeed(SNAPSHOT));
  const eventsSpy = vi.fn(events);
  const backend = { name: 'herdr', list, events: eventsSpy } as unknown as TerminalBackend;
  return { backend, list, events: eventsSpy };
}

const failOpen = (): EventsResult => Effect.fail(new Error('connect ENOENT herdr.sock')) as unknown as EventsResult;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  _resetBackendInventoryForTests();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  _resetBackendInventoryForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('backend inventory event stream — re-open with backoff', () => {
  it('re-opens a stream that could not be opened at boot, backing off 1 s then 2 s, and warns once', async () => {
    const s = controlledStream();
    let attempt = 0;
    const b = backendWith(() => (++attempt <= 2 ? failOpen() : Effect.succeed(s.stream) as unknown as EventsResult));
    const deltas: BackendPaneDelta[] = [];
    onBackendPanesChanged((delta) => deltas.push(delta));

    await startBackendInventory({ backend: b.backend });
    expect(b.events).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(b.events).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.events).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(b.events).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.events).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);

    // The re-opened stream is live: an event reaches the read model.
    s.push({ kind: 'agent-state', paneId: 'w1:p1', state: 'idle' });
    await vi.advanceTimersByTimeAsync(0);
    expect(deltas.at(-1)?.changed).toEqual([expect.objectContaining({ id: 'w1:p1', state: 'idle' })]);
  });

  it('re-opens a stream that ended and folds onto a fresh snapshot', async () => {
    const first = controlledStream();
    const second = controlledStream();
    const streams = [first.stream, second.stream];
    const b = backendWith(() => Effect.succeed(streams.shift() as BackendEventStream) as unknown as EventsResult);

    await startBackendInventory({ backend: b.backend });
    expect(b.list).toHaveBeenCalledTimes(1);

    first.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.events).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.events).toHaveBeenCalledTimes(2);
    expect(b.list).toHaveBeenCalledTimes(2);
  });

  it('caps the backoff at 30 s and keeps trying', async () => {
    const b = backendWith(failOpen);
    await startBackendInventory({ backend: b.backend });

    // 1 + 2 + 4 + 8 + 16 = 31 s for five retries, then 30 s each.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(b.events).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(EVENT_STREAM_RETRY_MAX_MS - 1);
    expect(b.events).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.events).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(EVENT_STREAM_RETRY_MAX_MS);
    expect(b.events).toHaveBeenCalledTimes(8);
  });

  it('stops retrying once the inventory is stopped', async () => {
    const b = backendWith(failOpen);
    await startBackendInventory({ backend: b.backend });
    stopBackendInventory();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(b.events).toHaveBeenCalledTimes(1);
  });

  it('never retries a backend that cannot stream events at all', async () => {
    const b = backendWith(() => Effect.succeed(unsupported('no events')) as unknown as EventsResult);
    await startBackendInventory({ backend: b.backend });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(b.events).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('retries when opening the stream throws outright instead of failing', async () => {
    const b = backendWith(() => { throw new Error('adapter defect'); });
    await expect(startBackendInventory({ backend: b.backend })).resolves.toBeUndefined();
    expect(b.events).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.events).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain('could not be opened (adapter defect)');
  });

  it('is idempotent while a retry is pending', async () => {
    const b = backendWith(failOpen);
    await startBackendInventory({ backend: b.backend });
    await startBackendInventory({ backend: b.backend });
    expect(b.events).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.events).toHaveBeenCalledTimes(2);
  });

  it('abandons an open that is never acknowledged and retries (review of #4020, 4)', async () => {
    let resolveLate: ((stream: BackendEventStream) => void) | undefined;
    let attempt = 0;
    const late = controlledStream();
    const b = backendWith(() => {
      attempt += 1;
      if (attempt === 1) {
        return Effect.promise(() => new Promise<BackendEventStream>((resolve) => { resolveLate = resolve; })) as unknown as EventsResult;
      }
      return failOpen();
    });

    const starting = startBackendInventory({ backend: b.backend });
    await vi.advanceTimersByTimeAsync(EVENT_STREAM_OPEN_TIMEOUT_MS - 1);
    expect(b.events).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await starting;
    expect(warn.mock.calls[0]?.[0]).toContain('was not acknowledged within 15s');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.events).toHaveBeenCalledTimes(2);

    // The abandoned subscription, if it ever arrives, is closed rather than leaked.
    resolveLate?.(late.stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.stream.close).toHaveBeenCalled();
  });

  it('closes a stream whose reader throws before re-opening (review of #4020, 5)', async () => {
    const replacement = controlledStream();
    const throwing: BackendEventStream = {
      events: {
        async *[Symbol.asyncIterator]() {
          throw new Error('frame too large');
        },
      },
      close: vi.fn(),
    };
    const streams = [throwing, replacement.stream];
    const b = backendWith(() => Effect.succeed(streams.shift() as BackendEventStream) as unknown as EventsResult);

    await startBackendInventory({ backend: b.backend });
    await vi.advanceTimersByTimeAsync(0);
    expect(throwing.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.events).toHaveBeenCalledTimes(2);
  });

  it('closes the new stream when the re-open snapshot fails, then retries', async () => {
    const first = controlledStream();
    const second = controlledStream();
    const third = controlledStream();
    const streams = [first.stream, second.stream, third.stream];
    const b = backendWith(() => Effect.succeed(streams.shift() as BackendEventStream) as unknown as EventsResult);
    let lists = 0;
    b.list.mockImplementation(() => {
      lists += 1;
      if (lists === 2) throw new Error('list exploded');
      return Effect.succeed(SNAPSHOT);
    });

    await startBackendInventory({ backend: b.backend });
    first.end();
    await vi.advanceTimersByTimeAsync(1_000); // re-open: snapshot throws
    expect(b.events).toHaveBeenCalledTimes(2);
    expect(second.stream.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000); // backoff doubled, then succeeds
    expect(b.events).toHaveBeenCalledTimes(3);
    expect(third.stream.close).not.toHaveBeenCalled();
  });

  it('starts the backoff over after a quiet stream that stayed open (review of #4020, 8)', async () => {
    const opened: ReturnType<typeof controlledStream>[] = [];
    let attempt = 0;
    const b = backendWith(() => {
      attempt += 1;
      if (attempt === 2 || attempt === 3) return failOpen();
      const stream = controlledStream();
      opened.push(stream);
      return Effect.succeed(stream.stream) as unknown as EventsResult;
    });

    await startBackendInventory({ backend: b.backend });
    opened[0]?.end(); // ends at once: 1 s, then fail → 2 s, fail → 4 s
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
    expect(b.events).toHaveBeenCalledTimes(4);

    // This one stays open (no events) past the stable window, then drops.
    await vi.advanceTimersByTimeAsync(EVENT_STREAM_STABLE_MS);
    warn.mockClear();
    opened[1]?.end();
    await vi.advanceTimersByTimeAsync(999);
    expect(b.events).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.events).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
