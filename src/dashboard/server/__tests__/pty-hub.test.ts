import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { addClientToHub, broadcastToHub, removeClientFromHub, setClientReady, type PtyHub } from '../pty-hub.js';

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
    clientStates: new Map(),
  };
}

// ── broadcastToHub ─────────────────────────────────────────────────────────────

describe('broadcastToHub', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends data to all OPEN ready clients', () => {
    const ws1 = makeMockWs(WebSocket.OPEN);
    const ws2 = makeMockWs(WebSocket.OPEN);
    const hub = makeHub(ws1, ws2);
    addClientToHub(hub, ws1, true);
    addClientToHub(hub, ws2, true);

    broadcastToHub(hub, 'hello');
    vi.runAllTimers();

    expect(ws1.send).toHaveBeenCalledWith('hello');
    expect(ws2.send).toHaveBeenCalledWith('hello');
  });

  it('skips clients that are not OPEN', () => {
    const open = makeMockWs(WebSocket.OPEN);
    const closed = makeMockWs(WebSocket.CLOSED);
    const connecting = makeMockWs(WebSocket.CONNECTING);
    const hub = makeHub(open, closed, connecting);
    addClientToHub(hub, open, true);
    addClientToHub(hub, closed, true);
    addClientToHub(hub, connecting, true);

    broadcastToHub(hub, 'ping');
    vi.runAllTimers();

    expect(open.send).toHaveBeenCalledWith('ping');
    expect(closed.send).not.toHaveBeenCalled();
    expect(connecting.send).not.toHaveBeenCalled();
  });

  it('does nothing with an empty client set', () => {
    const hub = makeHub();
    expect(() => broadcastToHub(hub, 'noop')).not.toThrow();
  });

  it('buffers output for clients that are not ready yet', () => {
    const open = makeMockWs(WebSocket.OPEN);
    const hub = makeHub(open);
    addClientToHub(hub, open, false);

    broadcastToHub(hub, 'scrollback-flood');
    vi.runAllTimers();

    expect(open.send).not.toHaveBeenCalled();
    expect(hub.clientStates.get(open)?.pending).toEqual(['scrollback-flood']);
  });

  it('flushes buffered output when a client becomes ready', () => {
    const open = makeMockWs(WebSocket.OPEN);
    const hub = makeHub(open);
    addClientToHub(hub, open, false);

    broadcastToHub(hub, 'normal-data');
    vi.runAllTimers();
    setClientReady(hub, open);

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
