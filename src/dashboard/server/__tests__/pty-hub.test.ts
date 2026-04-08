import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { broadcastToHub, removeClientFromHub, type PtyHub } from '../pty-hub.js';

// Minimal mock WebSocket — only the properties our code uses.
function makeMockWs(readyState: number = WebSocket.OPEN): WebSocket {
  return {
    readyState,
    send: vi.fn(),
  } as unknown as WebSocket;
}

// Minimal mock PTY — only the interface shape; never called in these tests.
function makeMockPty() {
  return {} as import('@homebridge/node-pty-prebuilt-multiarch').IPty;
}

function makeHub(...clients: WebSocket[]): PtyHub {
  return {
    pty: makeMockPty(),
    clients: new Set(clients),
    cols: 120,
    rows: 30,
    inputClient: null,
    clientBlackout: new Map(),
  };
}

// ── broadcastToHub ─────────────────────────────────────────────────────────────

describe('broadcastToHub', () => {
  it('sends data to all OPEN clients', () => {
    const ws1 = makeMockWs(WebSocket.OPEN);
    const ws2 = makeMockWs(WebSocket.OPEN);
    const hub = makeHub(ws1, ws2);

    broadcastToHub(hub, 'hello');

    expect(ws1.send).toHaveBeenCalledWith('hello');
    expect(ws2.send).toHaveBeenCalledWith('hello');
  });

  it('skips clients that are not OPEN', () => {
    const open = makeMockWs(WebSocket.OPEN);
    const closed = makeMockWs(WebSocket.CLOSED);
    const connecting = makeMockWs(WebSocket.CONNECTING);
    const hub = makeHub(open, closed, connecting);

    broadcastToHub(hub, 'ping');

    expect(open.send).toHaveBeenCalledWith('ping');
    expect(closed.send).not.toHaveBeenCalled();
    expect(connecting.send).not.toHaveBeenCalled();
  });

  it('does nothing with an empty client set', () => {
    const hub = makeHub();
    expect(() => broadcastToHub(hub, 'noop')).not.toThrow();
  });

  it('skips clients within their blackout window', () => {
    const open = makeMockWs(WebSocket.OPEN);
    const hub = makeHub(open);
    hub.clientBlackout.set(open, Date.now() + 10_000); // 10s blackout

    broadcastToHub(hub, 'scrollback-flood');

    expect(open.send).not.toHaveBeenCalled();
  });

  it('forwards to clients whose blackout has expired', () => {
    const open = makeMockWs(WebSocket.OPEN);
    const hub = makeHub(open);
    hub.clientBlackout.set(open, Date.now() - 1); // expired 1ms ago

    broadcastToHub(hub, 'normal-data');

    expect(open.send).toHaveBeenCalledWith('normal-data');
  });
});

// ── removeClientFromHub ────────────────────────────────────────────────────────

describe('removeClientFromHub', () => {
  let hubs: Map<string, PtyHub>;

  beforeEach(() => {
    hubs = new Map();
  });

  it('removes the client from the hub', () => {
    const ws = makeMockWs();
    const hub = makeHub(ws);
    hubs.set('my-session', hub);

    removeClientFromHub(hubs, 'my-session', ws);

    expect(hub.clients.has(ws)).toBe(false);
  });

  it('returns false when there are still clients remaining', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    const hub = makeHub(ws1, ws2);
    hubs.set('sess', hub);

    const tornDown = removeClientFromHub(hubs, 'sess', ws1);

    expect(tornDown).toBe(false);
    expect(hubs.has('sess')).toBe(true); // hub still registered
    expect(hub.clients.size).toBe(1);
  });

  it('returns true and deletes hub when last client disconnects', () => {
    const ws = makeMockWs();
    const hub = makeHub(ws);
    hubs.set('sess', hub);

    const tornDown = removeClientFromHub(hubs, 'sess', ws);

    expect(tornDown).toBe(true);
    expect(hubs.has('sess')).toBe(false); // hub removed from registry
  });

  it('returns false and is a no-op for an unknown session', () => {
    const ws = makeMockWs();

    const tornDown = removeClientFromHub(hubs, 'nonexistent', ws);

    expect(tornDown).toBe(false);
  });

  it('is a no-op if the client was not in the hub', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs(); // not in hub
    const hub = makeHub(ws1);
    hubs.set('sess', hub);

    const tornDown = removeClientFromHub(hubs, 'sess', ws2);

    // ws2 wasn't there, hub still has ws1
    expect(hub.clients.size).toBe(1);
    expect(tornDown).toBe(false);
  });
});
