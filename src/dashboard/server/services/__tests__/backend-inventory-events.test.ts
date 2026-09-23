/**
 * The pane event stream re-opens with backoff when Herdr is not up at
 * dashboard boot or the stream drops (PAN-3956 review finding 8).
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendAgentSnapshot } from '@overdeck/contracts';

import {
  EVENT_STREAM_RETRY_MAX_MS,
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

  it('is idempotent while a retry is pending', async () => {
    const b = backendWith(failOpen);
    await startBackendInventory({ backend: b.backend });
    await startBackendInventory({ backend: b.backend });
    expect(b.events).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.events).toHaveBeenCalledTimes(2);
  });
});
