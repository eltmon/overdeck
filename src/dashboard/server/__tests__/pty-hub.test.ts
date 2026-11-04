import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  addClientToHub,
  addHubListener,
  broadcastToHub,
  notifyHubExit,
  notifyHubSize,
  removeClientFromHub,
  removeHubListener,
  setClientReady,
  type PtyHub,
  type PtyHubListener,
} from '../pty-hub.js';

// Minimal mock WebSocket — only the properties our code uses.
function makeMockWs(readyState: number = WebSocket.OPEN): WebSocket {
  return {
    readyState,
    send: vi.fn(),
  } as unknown as WebSocket;
}

// Minimal mock PTY — only the interface shape; never called in these tests.
function makeMockPty() {
  return {} as import('@lydell/node-pty').IPty;
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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
    vi.runAllTimers();
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

// ── hub listeners (PAN-4477) ───────────────────────────────────────────────────

function makeKillablePty() {
  return { kill: vi.fn() } as unknown as import('@lydell/node-pty').IPty;
}

function makeListenerHub(...clients: WebSocket[]): PtyHub {
  return {
    pty: makeKillablePty(),
    clients: new Set(clients),
    cols: 120,
    rows: 30,
    pendingInput: [],
    inputClient: null,
    clientStates: new Map(),
  };
}

function makeListener(): PtyHubListener & {
  onData: ReturnType<typeof vi.fn>;
  onSize: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
} {
  return { onData: vi.fn(), onSize: vi.fn(), onExit: vi.fn() };
}

describe('hub listener output', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives a listener the same coalesced string as an open ready client', () => {
    const ws = makeMockWs(WebSocket.OPEN);
    const hub = makeListenerHub(ws);
    addClientToHub(hub, ws, true);
    const listener = makeListener();
    addHubListener(hub, listener);

    broadcastToHub(hub, 'abc');
    broadcastToHub(hub, 'def');
    vi.advanceTimersByTime(4);

    expect(ws.send).toHaveBeenCalledWith('abcdef');
    expect(listener.onData).toHaveBeenCalledTimes(1);
    expect(listener.onData).toHaveBeenCalledWith('abcdef');
  });

  it('drops a listener that throws and still feeds the others', () => {
    const hub = makeListenerHub();
    const thrower = makeListener();
    thrower.onData.mockImplementation(() => { throw new Error('boom'); });
    const healthy = makeListener();
    addHubListener(hub, thrower);
    addHubListener(hub, healthy);

    broadcastToHub(hub, 'first');
    vi.advanceTimersByTime(4);
    broadcastToHub(hub, 'second');
    vi.advanceTimersByTime(4);

    expect(thrower.onData).toHaveBeenCalledTimes(1);
    expect(healthy.onData).toHaveBeenNthCalledWith(1, 'first');
    expect(healthy.onData).toHaveBeenNthCalledWith(2, 'second');

    notifyHubExit(hub);
    expect(thrower.onExit).not.toHaveBeenCalled();
    expect(healthy.onExit).toHaveBeenCalledTimes(1);
  });

  it('notifyHubSize passes the hub cols and rows', () => {
    const hub = makeListenerHub();
    const listener = makeListener();
    addHubListener(hub, listener);
    hub.cols = 90;
    hub.rows = 25;

    notifyHubSize(hub);

    expect(listener.onSize).toHaveBeenCalledWith(90, 25);
  });

  it('notifyHubExit calls onExit once and later flushes reach no listener', () => {
    const hub = makeListenerHub();
    const listener = makeListener();
    addHubListener(hub, listener);

    notifyHubExit(hub);
    notifyHubExit(hub);
    broadcastToHub(hub, 'after-exit');
    vi.advanceTimersByTime(4);

    expect(listener.onExit).toHaveBeenCalledTimes(1);
    expect(listener.onData).not.toHaveBeenCalled();
  });
});

describe('hub teardown with listeners', () => {
  let hubs: Map<string, PtyHub>;

  beforeEach(() => {
    hubs = new Map();
  });

  it('keeps the hub when the last client leaves while a listener remains', () => {
    const ws = makeMockWs();
    const hub = makeListenerHub(ws);
    hub.inputClient = ws;
    hubs.set('sess', hub);
    addHubListener(hub, makeListener());

    const tornDown = removeClientFromHub(hubs, 'sess', ws);

    expect(tornDown).toBe(false);
    expect(hubs.get('sess')).toBe(hub);
    expect(hub.pty?.kill).not.toHaveBeenCalled();
    expect(hub.inputClient).toBeNull();
  });

  it('tears the hub down when the last listener leaves and no client remains', () => {
    const hub = makeListenerHub();
    hubs.set('sess', hub);
    const listener = makeListener();
    addHubListener(hub, listener);

    const tornDown = removeHubListener(hubs, 'sess', hub, listener);

    expect(tornDown).toBe(true);
    expect(hubs.has('sess')).toBe(false);
    expect(hub.pty?.kill).toHaveBeenCalledTimes(1);
  });

  it('keeps the hub when a listener leaves while a client remains', () => {
    const ws = makeMockWs();
    const hub = makeListenerHub(ws);
    hubs.set('sess', hub);
    const listener = makeListener();
    addHubListener(hub, listener);

    const tornDown = removeHubListener(hubs, 'sess', hub, listener);

    expect(tornDown).toBe(false);
    expect(hubs.get('sess')).toBe(hub);
    expect(hub.pty?.kill).not.toHaveBeenCalled();
  });

  it('removing a listener from a stale hub kills only that hub and keeps its successor registered', () => {
    const oldHub = makeListenerHub();
    const newHub = makeListenerHub();
    hubs.set('sess', oldHub);
    const listener = makeListener();
    addHubListener(oldHub, listener);
    hubs.set('sess', newHub);

    const tornDown = removeHubListener(hubs, 'sess', oldHub, listener);

    expect(tornDown).toBe(true);
    expect(oldHub.pty?.kill).toHaveBeenCalledTimes(1);
    expect(newHub.pty?.kill).not.toHaveBeenCalled();
    expect(hubs.get('sess')).toBe(newHub);
  });
});
