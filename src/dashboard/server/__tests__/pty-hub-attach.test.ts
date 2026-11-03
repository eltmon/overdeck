import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { WebSocket } from 'ws';
import type * as pty from '@lydell/node-pty';
import { addClientToHub, addHubListener, notifyHubSize, type PtyHub } from '../pty-hub.js';
import {
  attachHubPty,
  parseTmuxClientSize,
  snapshotLines,
  subscribeToTmuxHub,
  type TmuxHubDeps,
} from '../pty-hub-attach.js';
import type { TerminalFrame } from '../../../lib/terminal-backends/types.js';

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

describe('parseTmuxClientSize', () => {
  it('adds one row for status on, none for off and n for a digit', () => {
    expect(parseTmuxClientSize('100,30,on\n')).toEqual({ cols: 100, rows: 31 });
    expect(parseTmuxClientSize('100,30,off')).toEqual({ cols: 100, rows: 30 });
    expect(parseTmuxClientSize('100,30,2')).toEqual({ cols: 100, rows: 32 });
  });

  it('rejects malformed output', () => {
    expect(parseTmuxClientSize('100,30')).toBeNull();
    expect(parseTmuxClientSize('x,30,on')).toBeNull();
    expect(parseTmuxClientSize('100,0,on')).toBeNull();
    expect(parseTmuxClientSize('100,30,maybe')).toBeNull();
  });
});

describe('snapshotLines', () => {
  it('turns capture-pane LFs into CRLFs and drops the final LF', () => {
    expect(snapshotLines('one\ntwo\n\nfour\n')).toBe('one\r\ntwo\r\n\r\nfour');
    expect(snapshotLines('a\r\nb')).toBe('a\r\nb');
    expect(snapshotLines('')).toBe('');
  });
});

describe('subscribeToTmuxHub', () => {
  let hubs: Map<string, PtyHub>;
  const allPtys: Array<ReturnType<typeof makeFakePty>> = [];

  function makeDeps(overrides: Partial<TmuxHubDeps> = {}): TmuxHubDeps & { spawn: ReturnType<typeof vi.fn> } {
    const spawn = vi.fn((_session: string, _cols: number, _rows: number) => {
      const fake = makeFakePty();
      allPtys.push(fake);
      return fake;
    });
    return {
      hubs,
      sessionExists: async () => true,
      clientSize: async () => ({ cols: 100, rows: 31 }),
      captureViewport: async () => 'SCREEN',
      spawn,
      ...overrides,
    } as TmuxHubDeps & { spawn: ReturnType<typeof vi.fn> };
  }

  function existingHub(): PtyHub & { pty: ReturnType<typeof makeFakePty> } {
    const fake = makeFakePty();
    allPtys.push(fake);
    const hub = { ...makeHub(), cols: 120, rows: 40 };
    hubs.set('sess', hub);
    attachHubPty(hubs, 'sess', hub, fake);
    return hub as PtyHub & { pty: ReturnType<typeof makeFakePty> };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    hubs = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    for (const fake of allPtys) {
      expect(fake.write).not.toHaveBeenCalled();
      expect(fake.resize).not.toHaveBeenCalled();
    }
  });

  it('returns null without spawning when there is no hub and no session', async () => {
    const deps = makeDeps({ sessionExists: async () => false });

    const sub = await subscribeToTmuxHub('sess', () => {}, deps);

    expect(sub).toBeNull();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(hubs.has('sess')).toBe(false);
  });

  it('returns null when the client size cannot be read', async () => {
    const deps = makeDeps({ clientSize: async () => null });

    expect(await subscribeToTmuxHub('sess', () => {}, deps)).toBeNull();
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('starts a hub at the client size when none exists, with no input client', async () => {
    const deps = makeDeps();
    const frames: TerminalFrame[] = [];

    const sub = await subscribeToTmuxHub('sess', (f) => frames.push(f), deps);

    expect(sub).not.toBeNull();
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledWith('sess', 100, 31);
    const hub = hubs.get('sess');
    expect(hub?.inputClient).toBeNull();
    expect(hub?.pty).toBe(deps.spawn.mock.results[0]!.value);
    expect(frames).toEqual([{ kind: 'snapshot', cols: 100, rows: 31, data: 'SCREEN' }]);
  });

  it('reuses an existing hub and snapshots at its dims', async () => {
    existingHub();
    const deps = makeDeps();
    const frames: TerminalFrame[] = [];

    await subscribeToTmuxHub('sess', (f) => frames.push(f), deps);

    expect(deps.spawn).not.toHaveBeenCalled();
    expect(frames).toEqual([{ kind: 'snapshot', cols: 120, rows: 40, data: 'SCREEN' }]);
  });

  it('delivers output that arrives during the capture after the snapshot, in order', async () => {
    const hub = existingHub();
    let finishCapture: (data: string) => void = () => {};
    const deps = makeDeps({ captureViewport: () => new Promise<string>((resolve) => { finishCapture = resolve; }) });
    const frames: TerminalFrame[] = [];

    const subPromise = subscribeToTmuxHub('sess', (f) => frames.push(f), deps);
    hub.pty.emitData('a');
    await vi.advanceTimersByTimeAsync(4);
    hub.pty.emitData('b');
    await vi.advanceTimersByTimeAsync(4);
    expect(frames).toEqual([]);
    finishCapture('SCREEN');
    await subPromise;
    hub.pty.emitData('c');
    await vi.advanceTimersByTimeAsync(4);

    expect(frames).toEqual([
      { kind: 'snapshot', cols: 120, rows: 40, data: 'SCREEN' },
      { kind: 'output', data: 'ab' },
      { kind: 'output', data: 'c' },
    ]);
  });

  it('sends the captured lines with CRLF endings', async () => {
    existingHub();
    const frames: TerminalFrame[] = [];
    await subscribeToTmuxHub('sess', (f) => frames.push(f), makeDeps({ captureViewport: async () => 'top\n  indented\n' }));
    expect(frames).toEqual([{ kind: 'snapshot', cols: 120, rows: 40, data: 'top\r\n  indented' }]);
  });

  it('forwards a hub resize after the snapshot as a size frame', async () => {
    const hub = existingHub();
    const frames: TerminalFrame[] = [];
    await subscribeToTmuxHub('sess', (f) => frames.push(f), makeDeps());

    hub.cols = 132;
    hub.rows = 40;
    notifyHubSize(hub);

    expect(frames.at(-1)).toEqual({ kind: 'size', cols: 132, rows: 40 });
  });

  it('forwards a PTY exit as an exit frame', async () => {
    const hub = existingHub();
    const frames: TerminalFrame[] = [];
    await subscribeToTmuxHub('sess', (f) => frames.push(f), makeDeps());

    hub.pty.emitExit(0);

    expect(frames.at(-1)).toEqual({ kind: 'exit', code: null });
  });

  it('close() on a bridge-created hub with no clients kills the PTY and unregisters the hub', async () => {
    const deps = makeDeps();
    const sub = await subscribeToTmuxHub('sess', () => {}, deps);
    const fake = deps.spawn.mock.results[0]!.value as ReturnType<typeof makeFakePty>;

    sub!.close();
    sub!.close();

    expect(fake.kill).toHaveBeenCalledTimes(1);
    expect(hubs.has('sess')).toBe(false);
  });

  it('emits nothing after close()', async () => {
    const hub = existingHub();
    addClientToHub(hub, makeMockWs(), true);
    const frames: TerminalFrame[] = [];
    const sub = await subscribeToTmuxHub('sess', (f) => frames.push(f), makeDeps());

    sub!.close();
    hub.pty.emitData('late');
    await vi.advanceTimersByTimeAsync(4);
    notifyHubSize(hub);

    expect(frames).toEqual([{ kind: 'snapshot', cols: 120, rows: 40, data: 'SCREEN' }]);
    expect(hub.pty.kill).not.toHaveBeenCalled();
  });
});
