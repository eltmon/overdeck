import { describe, expect, it, vi } from 'vitest';

import { installRequestLog } from '../requestLog';

class FakeSocket {
  readonly sent: unknown[] = [];
  constructor(readonly url: string | URL) {}
  send(data: unknown): void {
    this.sent.push(data);
  }
}

function target() {
  return {
    fetch: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    WebSocket: FakeSocket as unknown as typeof WebSocket,
  };
}

describe('installRequestLog', () => {
  it('records a routed fetch once, without the query string, and ignores the directory', async () => {
    const t = target();
    const log = installRequestLog(t);
    await t.fetch('/api/conversations?limit=5');
    await t.fetch('/api/conversations?limit=10');
    await t.fetch('/api/conversations/x/message', { method: 'post' });
    await t.fetch('https://connect.overdeck.ai/v1/directory');
    expect(log.http).toEqual([
      { method: 'GET', path: '/api/conversations', status: 200 },
      { method: 'POST', path: '/api/conversations/x/message', status: 200 },
    ]);
  });

  it('records each RPC request tag sent on /ws/rpc once', () => {
    const t = target();
    const log = installRequestLog(t);
    const socket = new t.WebSocket('/ws/rpc');
    socket.send(JSON.stringify({ _tag: 'Request', id: '1', tag: 'pan.listConversations', payload: {}, headers: [] }));
    socket.send(JSON.stringify({ _tag: 'Request', id: '2', tag: 'pan.listConversations', payload: {}, headers: [] }));
    socket.send(JSON.stringify({ _tag: 'Ack', requestId: '1' }));
    socket.send(JSON.stringify([{ _tag: 'Request', id: '3', tag: 'pan.subscribeFleet', payload: {}, headers: [] }]));
    const directory = new t.WebSocket('wss://connect.overdeck.ai/v1/directory');
    directory.send(JSON.stringify({ _tag: 'Request', tag: 'not.recorded' }));
    expect(log.rpc).toEqual(['pan.listConversations', 'pan.subscribeFleet']);
    expect((globalThis as { __overdeckRequestLog?: unknown }).__overdeckRequestLog).toBeUndefined();
  });

  it('publishes the log on the target', () => {
    const t = target() as ReturnType<typeof target> & { __overdeckRequestLog?: unknown };
    const log = installRequestLog(t);
    expect(t.__overdeckRequestLog).toBe(log);
  });
});
