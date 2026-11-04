import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IceServer, SignalData } from '@overdeck/contracts';
import {
  BrowserJoin,
  CLOSE_FALLBACK_MS,
  ICE_TIMEOUT_MS,
  OFFER_WATCHDOG_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  type BrowserJoinView,
} from '../../../../../services/share/web/join-socket.ts';

const URL = 'wss://share.test/v1/rooms/BCDFGHJK/web-join?v=1';
const ICE: IceServer[] = [{ urls: ['stun:stun.test:3478'] }];
const OFFER: SignalData = { sdp: { type: 'offer', sdp: 'v=0' } };

type Listener = (event: unknown) => void;

/** Records what the code under test sends and closes; the test fires every event by hand. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  readonly sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 2;
  }

  private fire(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open(): void {
    this.readyState = 1;
    this.fire('open', {});
  }

  message(data: unknown): void {
    this.fire('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  closed(code: number): void {
    this.readyState = 3;
    this.fire('close', { code, reason: '' });
  }

  error(): void {
    this.fire('error', {});
  }

  frames(): unknown[] {
    return this.sent.filter((t) => t !== 'ping').map((t) => JSON.parse(t) as unknown);
  }
}

function setup() {
  const views: BrowserJoinView[] = [];
  const signals: SignalData[] = [];
  const preOpen = vi.fn();
  const join = new BrowserJoin(
    {
      WebSocket: FakeSocket as unknown as { new (url: string): WebSocket },
      url: URL,
      now: () => Date.now(),
      setTimeout: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as typeof setTimeout,
      clearTimeout: ((t: ReturnType<typeof setTimeout>) => clearTimeout(t)) as typeof clearTimeout,
      setInterval: ((fn: () => void, ms: number) => setInterval(fn, ms)) as typeof setInterval,
      clearInterval: ((t: ReturnType<typeof setInterval>) => clearInterval(t)) as typeof clearInterval,
    },
    { onView: (v) => views.push(v), onSignal: (d) => signals.push(d), onPreOpenFailure: preOpen },
  );
  const last = () => views[views.length - 1];
  const socket = (i: number) => FakeSocket.instances[i] as FakeSocket;
  return { join, views, signals, preOpen, last, socket };
}

/** Joins, opens the socket and reaches `admitted`. */
function admitted(t: ReturnType<typeof setup>, contributor = false): FakeSocket {
  t.join.join();
  const s = FakeSocket.instances[FakeSocket.instances.length - 1] as FakeSocket;
  s.open();
  s.message({ type: 'status', status: 'admitted', contributor });
  return s;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BrowserJoin states (PAN-4481 web-join-socket)', () => {
  it('join() opens one socket at the web-join URL in state connecting; a second join() while live does nothing', () => {
    const t = setup();
    t.join.join();
    t.join.join();
    expect(FakeSocket.instances.map((s) => s.url)).toEqual([URL]);
    expect(t.last()).toEqual({ state: 'connecting', contributor: false, closeCode: null, error: null });
  });

  it('maps each status frame to its state', () => {
    const t = setup();
    t.join.join();
    const s = t.socket(0);
    s.open();
    s.message({ type: 'status', status: 'lobby' });
    expect(t.last()?.state).toBe('lobby');
    s.message({ type: 'status', status: 'admitted', contributor: true });
    expect(t.last()).toMatchObject({ state: 'admitted', contributor: true });
    s.message({ type: 'status', status: 'host-disconnected' });
    expect(t.last()?.state).toBe('host-disconnected');
    s.message({ type: 'status', status: 'host-reconnected' });
    expect(t.last()?.state).toBe('admitted');
    s.message('[1,2]');
    s.message('not json');
    s.message({ type: 'mystery' });
    expect(t.last()?.state).toBe('admitted');
  });

  it('maps each close code to its terminal state; any other close after open is connection_lost', () => {
    const cases: Array<[number, string]> = [
      [1000, 'left'],
      [4003, 'revoked'],
      [4004, 'ended'],
      [4008, 'replaced'],
      [4009, 'is-host'],
      [4010, 'kicked'],
      [4011, 'revoked'],
      [4013, 'full'],
    ];
    for (const [code, state] of cases) {
      FakeSocket.instances = [];
      const t = setup();
      t.join.join();
      t.socket(0).open();
      t.socket(0).closed(code);
      expect(t.last(), String(code)).toEqual({ state, contributor: false, closeCode: code, error: null });
    }
    FakeSocket.instances = [];
    const t = setup();
    t.join.join();
    t.socket(0).open();
    t.socket(0).closed(1006);
    expect(t.last()).toMatchObject({ state: 'disconnected', closeCode: 1006, error: 'connection_lost' });
    expect(t.preOpen).not.toHaveBeenCalled();
  });

  it('an error or close before open calls onPreOpenFailure and becomes disconnected/unreachable', () => {
    const a = setup();
    a.join.join();
    a.socket(0).error();
    a.socket(0).closed(1006);
    expect(a.preOpen).toHaveBeenCalledTimes(1);
    expect(a.last()).toMatchObject({ state: 'disconnected', error: 'unreachable' });

    FakeSocket.instances = [];
    const b = setup();
    b.join.join();
    b.socket(0).closed(1006);
    expect(b.preOpen).toHaveBeenCalledTimes(1);
    expect(b.last()).toMatchObject({ state: 'disconnected', error: 'unreachable' });
  });

  it('forwards signals only while admitted or host-disconnected', () => {
    const t = setup();
    t.join.join();
    const s = t.socket(0);
    s.open();
    s.message({ type: 'status', status: 'lobby' });
    s.message({ type: 'signal', data: OFFER });
    expect(t.signals).toEqual([]);
    s.message({ type: 'status', status: 'admitted' });
    s.message({ type: 'signal', data: OFFER });
    s.message({ type: 'signal', data: 'not an object' });
    s.message({ type: 'status', status: 'host-disconnected' });
    s.message({ type: 'signal', data: { candidate: { candidate: 'c' } } });
    expect(t.signals).toEqual([OFFER, { candidate: { candidate: 'c' } }]);
  });

  it('sendSignal writes a signal frame only while admitted', () => {
    const t = setup();
    t.join.join();
    const s = t.socket(0);
    s.open();
    t.join.sendSignal({ sdp: { type: 'answer', sdp: 'a' } });
    expect(s.sent).toEqual([]);
    s.message({ type: 'status', status: 'admitted' });
    t.join.sendSignal({ sdp: { type: 'answer', sdp: 'a' } });
    expect(s.frames()).toContainEqual({ type: 'signal', data: { sdp: { type: 'answer', sdp: 'a' } } });
  });

  it('leave() sends leave and becomes left on the close, or after the fallback when no close arrives', () => {
    const a = setup();
    a.join.join();
    a.socket(0).open();
    a.join.leave();
    expect(a.socket(0).frames()).toEqual([{ type: 'leave' }]);
    a.socket(0).closed(1005);
    expect(a.last()?.state).toBe('left');

    FakeSocket.instances = [];
    const b = setup();
    b.join.join();
    b.socket(0).open();
    b.join.leave();
    vi.advanceTimersByTime(CLOSE_FALLBACK_MS - 1);
    expect(b.last()?.state).toBe('connecting');
    vi.advanceTimersByTime(1);
    expect(b.last()?.state).toBe('left');
  });

  it('close() tears down with no callbacks after it', () => {
    const t = setup();
    t.join.join();
    t.socket(0).open();
    const count = t.views.length;
    t.join.close();
    expect(t.socket(0).closeCalls).toHaveLength(1);
    t.socket(0).closed(1005);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS * 2);
    expect(t.views).toHaveLength(count);
    expect(t.preOpen).not.toHaveBeenCalled();
  });
});

describe('BrowserJoin keepalive', () => {
  it('pong is not JSON-parsed and refreshes the pong clock', () => {
    const t = setup();
    t.join.join();
    const s = t.socket(0);
    s.open();
    const parse = vi.spyOn(JSON, 'parse');
    s.message('pong');
    expect(parse).not.toHaveBeenCalled();
    expect(t.last()?.state).toBe('connecting');
  });

  it('sends ping every 30 s and closes the socket at 75 s without a pong', () => {
    const t = setup();
    t.join.join();
    const s = t.socket(0);
    s.open();
    vi.advanceTimersByTime(PING_INTERVAL_MS - 1);
    expect(s.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(s.sent).toEqual(['ping']);
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(s.sent).toEqual(['ping', 'ping']);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS - 2 * PING_INTERVAL_MS - 1);
    expect(s.closeCalls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(s.closeCalls).toHaveLength(1);
    expect(t.last()).toMatchObject({ state: 'disconnected', error: 'connection_lost' });
    s.closed(1005);
    expect(t.last()).toMatchObject({ state: 'disconnected', error: 'connection_lost' });
  });

  it('a pong pushes the 75 s deadline out', () => {
    const t = setup();
    t.join.join();
    const s = t.socket(0);
    s.open();
    vi.advanceTimersByTime(60_000);
    s.message('pong');
    vi.advanceTimersByTime(PONG_TIMEOUT_MS - 1);
    expect(s.closeCalls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(s.closeCalls).toHaveLength(1);
  });
});

describe('BrowserJoin ICE servers', () => {
  it('requests ICE once on admitted and serves the cached list afterwards', async () => {
    const t = setup();
    const s = admitted(t);
    expect(s.frames()).toEqual([{ type: 'ice-servers' }]);
    const pending = t.join.fetchIceServers();
    expect(s.frames()).toEqual([{ type: 'ice-servers' }]);
    s.message({ type: 'ice-servers', iceServers: ICE });
    expect(await pending).toEqual(ICE);
    expect(await t.join.fetchIceServers()).toEqual(ICE);
    s.message({ type: 'status', status: 'admitted' });
    expect(s.frames()).toEqual([{ type: 'ice-servers' }]);
  });

  it('turn_unavailable resolves []', async () => {
    const t = setup();
    const s = admitted(t);
    const pending = t.join.fetchIceServers();
    s.message({ type: 'error', code: 'turn_unavailable' });
    expect(await pending).toEqual([]);
  });

  it('no answer within 5 s resolves []', async () => {
    const t = setup();
    admitted(t);
    const pending = t.join.fetchIceServers();
    await vi.advanceTimersByTimeAsync(ICE_TIMEOUT_MS);
    expect(await pending).toEqual([]);
  });

  it('resolves [] at once outside the room', async () => {
    const t = setup();
    t.join.join();
    t.socket(0).open();
    expect(await t.join.fetchIceServers()).toEqual([]);
    expect(t.socket(0).sent).toEqual([]);
  });
});

describe('BrowserJoin restart dance', () => {
  it('reconnect() closes with 1000, sends no leave, and opens the next socket only from the close event', async () => {
    const t = setup();
    const first = admitted(t);
    const ice = t.join.fetchIceServers();
    t.join.reconnect();
    expect(first.closeCalls).toEqual([{ code: 1000, reason: 'reconnect' }]);
    expect(first.frames()).not.toContainEqual({ type: 'leave' });
    expect(FakeSocket.instances).toHaveLength(1);
    expect(await ice).toEqual([]);

    first.closed(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(t.last()?.state).toBe('connecting');
    expect(t.views.some((v) => v.state === 'left')).toBe(false);
  });

  it('opens the next socket after 5 s when the old socket never reports its close', () => {
    const t = setup();
    admitted(t);
    t.join.reconnect();
    vi.advanceTimersByTime(CLOSE_FALLBACK_MS - 1);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(t.last()?.state).toBe('connecting');
    t.socket(0).closed(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(t.last()?.state).toBe('connecting');
  });

  it('reconnect() from a terminal state opens a new socket at once', () => {
    const t = setup();
    t.join.join();
    t.socket(0).open();
    t.socket(0).closed(1006);
    t.join.reconnect();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(t.last()?.state).toBe('connecting');
  });

  it('the offer watchdog restarts once at 10 s and not again', () => {
    const t = setup();
    const first = admitted(t);
    vi.advanceTimersByTime(OFFER_WATCHDOG_MS - 1);
    expect(first.closeCalls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(first.closeCalls).toEqual([{ code: 1000, reason: 'reconnect' }]);
    first.closed(1000);
    expect(FakeSocket.instances).toHaveLength(2);

    const second = t.socket(1);
    second.open();
    second.message({ type: 'status', status: 'admitted' });
    vi.advanceTimersByTime(OFFER_WATCHDOG_MS * 3);
    expect(second.closeCalls).toEqual([]);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(t.last()?.state).toBe('admitted');
  });

  it('an offer before 10 s disarms the watchdog', () => {
    const t = setup();
    const s = admitted(t);
    vi.advanceTimersByTime(OFFER_WATCHDOG_MS / 2);
    s.message({ type: 'signal', data: OFFER });
    vi.advanceTimersByTime(OFFER_WATCHDOG_MS * 2);
    expect(s.closeCalls).toEqual([]);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
