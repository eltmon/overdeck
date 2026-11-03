import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import type * as pty from '@lydell/node-pty';
import { addClientToHub, addHubListener, type PtyHub } from '../pty-hub.js';
import { attachHubPty } from '../pty-hub-attach.js';

function makeMockWs(readyState: number = WebSocket.OPEN): WebSocket {
  return { readyState, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
}

/** A fake IPty whose data and exit events the test fires by hand. */
function makeFakePty() {
  const dataListeners: Array<(data: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
  const fake = {
    onData: (listener: (data: string) => void) => {
      dataListeners.push(listener);
      return { dispose: () => {} };
    },
    onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => {
      exitListeners.push(listener);
      return { dispose: () => {} };
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (data: string) => { for (const l of dataListeners) l(data); },
    emitExit: (exitCode = 0) => { for (const l of exitListeners) l({ exitCode }); },
  };
  return fake as typeof fake & pty.IPty;
}

function makeHub(...clients: WebSocket[]): PtyHub {
  return {
    pty: null,
    clients: new Set(clients),
    cols: 120,
    rows: 30,
    pendingInput: [],
    inputClient: null,
    clientStates: new Map(),
  };
}

describe('attachHubPty', () => {
  let hubs: Map<string, PtyHub>;

  beforeEach(() => {
    vi.useFakeTimers();
    hubs = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets hub.pty and sends PTY output to an open ready client after the coalescing window', () => {
    const ws = makeMockWs();
    const hub = makeHub();
    addClientToHub(hub, ws, true);
    hubs.set('sess', hub);
    const fake = makeFakePty();

    attachHubPty(hubs, 'sess', hub, fake);
    fake.emitData('hello');
    expect(ws.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4);

    expect(hub.pty).toBe(fake);
    expect(ws.send).toHaveBeenCalledWith('hello');
  });

  it('on exit closes open clients, unregisters the hub and tells listeners', () => {
    const open = makeMockWs(WebSocket.OPEN);
    const closed = makeMockWs(WebSocket.CLOSED);
    const hub = makeHub();
    addClientToHub(hub, open, true);
    addClientToHub(hub, closed, true);
    hubs.set('sess', hub);
    const listener = { onData: vi.fn(), onSize: vi.fn(), onExit: vi.fn() };
    addHubListener(hub, listener);
    const fake = makeFakePty();

    attachHubPty(hubs, 'sess', hub, fake);
    fake.emitExit(0);

    expect(open.close).toHaveBeenCalledWith(1000, 'Session ended');
    expect(closed.close).not.toHaveBeenCalled();
    expect(hubs.has('sess')).toBe(false);
    expect(hub.clients.size).toBe(0);
    expect(hub.clientStates.size).toBe(0);
    expect(listener.onExit).toHaveBeenCalledTimes(1);
  });

  it('on exit leaves a registry entry that now points at a different hub', () => {
    const oldHub = makeHub();
    const newHub = makeHub();
    hubs.set('sess', oldHub);
    const fake = makeFakePty();

    attachHubPty(hubs, 'sess', oldHub, fake);
    hubs.set('sess', newHub);
    fake.emitExit(0);

    expect(hubs.get('sess')).toBe(newHub);
  });
});
