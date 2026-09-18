import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import {
  HerdrApiClient,
  HerdrApiError,
  isMutatingHerdrMethod,
  type HerdrSocket,
} from '../../../../src/lib/terminal-backends/herdr-api.js';

/**
 * PAN-3917 W8. The Herdr API is NDJSON over a unix socket, one request per
 * connection. These cases pin the framing and the safety rules; no test here
 * touches a real socket — the connection factory is injected.
 */

/** A scriptable stand-in for the server side of one connection. */
class FakeSocket extends EventEmitter implements HerdrSocket {
  readonly written: string[] = [];
  destroyed = false;

  write(data: string): boolean {
    this.written.push(data);
    return true;
  }

  end(): void {
    this.destroyed = true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** Server sends a chunk of raw bytes (possibly a partial line). */
  feed(chunk: string): void {
    this.emit('data', Buffer.from(chunk, 'utf-8'));
  }

  connect(): void {
    this.emit('connect');
  }
}

function clientWith(socket: FakeSocket, options: Record<string, unknown> = {}): HerdrApiClient {
  return new HerdrApiClient({ socketPath: '/tmp/fake.sock', connect: () => socket, ...options });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HerdrApiClient.call framing', () => {
  it('reassembles a response split across chunks', async () => {
    const socket = new FakeSocket();
    const client = clientWith(socket);
    const pending = client.call('session.snapshot', {});
    socket.connect();

    const request = JSON.parse(socket.written[0]) as { id: string; method: string };
    expect(request.method).toBe('session.snapshot');

    const response = JSON.stringify({ id: request.id, result: { type: 'session_snapshot', snapshot: { panes: [] } } });
    socket.feed(response.slice(0, 20));
    socket.feed(response.slice(20));
    socket.feed('\n');

    await expect(pending).resolves.toEqual({ type: 'session_snapshot', snapshot: { panes: [] } });
    expect(socket.destroyed).toBe(true);
  });

  it('keeps unknown optional fields instead of rejecting the response', async () => {
    const socket = new FakeSocket();
    const client = clientWith(socket);
    const pending = client.call<{ type: string; agent: Record<string, unknown> }>('agent.get', { target: 'a' });
    socket.connect();
    const { id } = JSON.parse(socket.written[0]) as { id: string };
    socket.feed(`${JSON.stringify({
      id,
      result: { type: 'agent_info', agent: { pane_id: 'w1:p2', agent_status: 'idle', future_field: 42 } },
    })}\n`);

    const result = await pending;
    expect(result.agent.future_field).toBe(42);
  });

  it('accepts a parse-level error whose id is empty as the answer', async () => {
    const socket = new FakeSocket();
    const client = clientWith(socket);
    const pending = client.call('bogus.method', {});
    socket.connect();
    socket.feed(`${JSON.stringify({ id: '', error: { code: 'invalid_request', message: 'unknown variant' } })}\n`);

    await expect(pending).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('aborts a frame that grows past the cap instead of buffering it forever', async () => {
    const socket = new FakeSocket();
    const client = clientWith(socket, { maxFrameBytes: 64 });
    const pending = client.call('session.snapshot', {});
    socket.connect();
    socket.feed('x'.repeat(200));

    await expect(pending).rejects.toMatchObject({ code: 'frame_too_large' });
  });
});

describe('HerdrApiClient.call safety rules', () => {
  it('marks a mutating call ambiguous when the server disconnects with no answer, and never retries it', async () => {
    const connections: FakeSocket[] = [];
    const client = new HerdrApiClient({
      socketPath: '/tmp/fake.sock',
      connect: () => {
        const socket = new FakeSocket();
        connections.push(socket);
        return socket;
      },
    });
    const pending = client.call('agent.prompt', { target: 'a', text: 'hi' });
    connections[0].connect();
    connections[0].emit('close');

    const error = await pending.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HerdrApiError);
    expect(error).toMatchObject({ code: 'disconnected', ambiguous: true });
    // One connection, one attempt: the client must not re-send a mutation whose
    // outcome it cannot know.
    expect(connections).toHaveLength(1);
  });

  it('does not mark a read ambiguous', async () => {
    const socket = new FakeSocket();
    const client = clientWith(socket);
    const pending = client.call('agent.list', {});
    socket.connect();
    socket.emit('close');

    await expect(pending).rejects.toMatchObject({ ambiguous: false });
  });

  it('times out on the caller deadline (fake timers)', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = clientWith(socket, { requestTimeoutMs: 5_000 });
    const pending = client.call('agent.list', {});
    socket.connect();
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
  });

  it('classifies every mutating method it sends', () => {
    expect(isMutatingHerdrMethod('workspace.create')).toBe(true);
    expect(isMutatingHerdrMethod('agent.prompt')).toBe(true);
    expect(isMutatingHerdrMethod('pane.send_input')).toBe(true);
    expect(isMutatingHerdrMethod('session.snapshot')).toBe(false);
    expect(isMutatingHerdrMethod('agent.list')).toBe(false);
  });
});

describe('HerdrApiClient.stream', () => {
  it('acknowledges the subscription, then delivers events, and snapshots come from a fresh call', async () => {
    const sockets: FakeSocket[] = [];
    const client = new HerdrApiClient({
      socketPath: '/tmp/fake.sock',
      connect: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const seen: Array<{ event: string; data: Record<string, unknown> }> = [];
    const stream = client.stream('events.subscribe', { subscriptions: [{ type: 'pane.created' }] }, {
      onEvent: (event, data) => seen.push({ event, data }),
    });
    const subscription = sockets[0];
    subscription.connect();
    const { id } = JSON.parse(subscription.written[0]) as { id: string };
    subscription.feed(`${JSON.stringify({ id, result: { type: 'subscription_started' } })}\n`);
    await stream.started;

    subscription.feed(`${JSON.stringify({ event: 'pane_created', data: { pane: { pane_id: 'w1:p3' } } })}\n`);
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toBe('pane_created');

    // A reconnect re-reads the snapshot on its own connection; the subscription
    // socket is never reused for a request.
    const snapshot = client.call('session.snapshot', {});
    sockets[1].connect();
    const snapshotId = (JSON.parse(sockets[1].written[0]) as { id: string }).id;
    sockets[1].feed(`${JSON.stringify({ id: snapshotId, result: { type: 'session_snapshot', snapshot: { panes: [] } } })}\n`);
    await expect(snapshot).resolves.toMatchObject({ type: 'session_snapshot' });

    stream.close();
  });

  it('rejects `started` when the server closes before acknowledging', async () => {
    const socket = new FakeSocket();
    const client = clientWith(socket);
    const stream = client.stream('events.subscribe', { subscriptions: [] }, { onEvent: () => {} });
    socket.connect();
    socket.emit('close');
    await expect(stream.started).rejects.toMatchObject({ code: 'disconnected' });
  });
});
