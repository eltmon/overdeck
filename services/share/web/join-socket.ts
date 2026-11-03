/**
 * The hosted viewer's web-join socket and its state machine (PRD PAN-4481 WI-7; FR-13, D-12, D-13).
 *
 * `BrowserJoin` owns one `wss://…/v1/rooms/<CODE>/web-join?v=1` socket at a time and mirrors the
 * viewer server's join rules (src/dashboard/server/services/share-join.ts): status frames move the
 * state, close codes end it, `ice-servers` answers are cached for 50 minutes. A browser cannot send
 * protocol pings, so the keepalive is the text `ping` answered `pong` by the room (FR-10).
 *
 * The restart dance (PAN-4474): close the old socket with 1000 and no `leave`, and open the new one
 * only from the old one's `close` event (or after a 5 s fallback). Opening first gets the old socket
 * replaced with 4008 and the host never re-offers. The offer watchdog runs that dance once when no
 * offer arrives within 10 s of `status admitted` (D-12).
 *
 * No DOM access and no runtime import from contracts, so unit tests run it in node.
 */
import type { IceServer, JoinState, ServiceToViewerFrame, SignalData } from '@overdeck/contracts';

type Timer = ReturnType<typeof setTimeout>;
type Interval = ReturnType<typeof setInterval>;

export interface BrowserJoinDeps {
  /** The browser global in production. */
  WebSocket: { new (url: string): WebSocket };
  /** wss://<host>/v1/rooms/<CODE>/web-join?v=1 */
  url: string;
  now(): number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export type BrowserJoinState = Exclude<JoinState, 'away'>;

export interface BrowserJoinView {
  state: BrowserJoinState;
  contributor: boolean;
  closeCode: number | null;
  error: string | null;
}

export interface BrowserJoinCallbacks {
  onView(view: BrowserJoinView): void;
  /** Only while admitted or host-disconnected. */
  onSignal(data: SignalData): void;
  /** D-13: the socket failed before `open`; the page re-reads its session to tell why. */
  onPreOpenFailure(): void;
}

export const PING_INTERVAL_MS = 30_000;
export const PONG_TIMEOUT_MS = 75_000;
export const ICE_TIMEOUT_MS = 5_000;
export const ICE_CACHE_MS = 50 * 60_000;
export const CLOSE_FALLBACK_MS = 5_000;
export const OFFER_WATCHDOG_MS = 10_000;

/** WebSocket.OPEN; a literal so injected fakes need no static constants. */
const OPEN = 1;

/** Close codes the share service uses, mapped to the state they end in. */
const CLOSE_STATES: ReadonlyMap<number, BrowserJoinState> = new Map([
  [1000, 'left'],
  [4003, 'revoked'],
  [4004, 'ended'],
  [4008, 'replaced'],
  [4009, 'is-host'],
  [4010, 'kicked'],
  [4011, 'revoked'],
  [4013, 'full'],
]);

interface Conn {
  readonly socket: WebSocket;
  opened: boolean;
  done: boolean;
  ping: Interval | null;
  pongTimeout: Timer | null;
  watchdog: Timer | null;
}

interface IcePending {
  readonly promise: Promise<readonly IceServer[]>;
  readonly resolve: (iceServers: readonly IceServer[]) => void;
  readonly timer: Timer;
}

export class BrowserJoin {
  private conn: Conn | null = null;
  private view: BrowserJoinView = { state: 'connecting', contributor: false, closeCode: null, error: null };
  private leaving = false;
  private restarting = false;
  private torndown = false;
  private closeFallback: Timer | null = null;
  /** Watchdog restarts since the last Join, Reconnect or offer; the watchdog restarts at most once (D-12). */
  private watchdogRestarts = 0;
  private iceCache: { readonly iceServers: readonly IceServer[]; readonly at: number } | null = null;
  private icePending: IcePending | null = null;

  constructor(
    private readonly deps: BrowserJoinDeps,
    private readonly callbacks: BrowserJoinCallbacks,
  ) {}

  /** Opens a socket unless one is live; state `connecting`. */
  join(): void {
    if (this.torndown || (this.conn && !this.conn.done)) return;
    this.leaving = false;
    this.restarting = false;
    this.watchdogRestarts = 0;
    this.open();
  }

  /** Sends `leave`; the state becomes `left` on the close, or after CLOSE_FALLBACK_MS. */
  leave(): void {
    const conn = this.conn;
    if (this.torndown || !conn || conn.done) return;
    this.restarting = false;
    if (conn.socket.readyState === OPEN) {
      this.leaving = true;
      this.send(conn, JSON.stringify({ type: 'leave' }));
      this.armCloseFallback(() => {
        this.finish(conn);
        this.leaving = false;
        this.setView({ state: 'left' });
      });
      return;
    }
    this.finish(conn);
    this.setView({ state: 'left' });
  }

  /** The restart dance, for the Reconnect button. */
  reconnect(): void {
    if (this.torndown) return;
    this.watchdogRestarts = 0;
    this.restart();
  }

  /** Relays the browser's answer or ICE candidate to the host. */
  sendSignal(data: SignalData): void {
    const conn = this.conn;
    if (!conn || conn.done || !this.inRoom()) return;
    this.send(conn, JSON.stringify({ type: 'signal', data }));
  }

  /** A cached list younger than ICE_CACHE_MS, else one request; `[]` on turn_unavailable or after ICE_TIMEOUT_MS. */
  fetchIceServers(): Promise<readonly IceServer[]> {
    if (this.iceCache && this.deps.now() - this.iceCache.at < ICE_CACHE_MS) return Promise.resolve(this.iceCache.iceServers);
    if (this.icePending) return this.icePending.promise;
    const conn = this.conn;
    if (!conn || conn.done || conn.socket.readyState !== OPEN || !this.inRoom()) return Promise.resolve([]);
    let resolve!: (iceServers: readonly IceServer[]) => void;
    const promise = new Promise<readonly IceServer[]>((r) => {
      resolve = r;
    });
    const timer = this.deps.setTimeout(() => this.resolveIce([]), ICE_TIMEOUT_MS);
    this.icePending = { promise, resolve, timer };
    this.send(conn, JSON.stringify({ type: 'ice-servers' }));
    return promise;
  }

  /** Page unload or teardown: a plain close, and no callbacks after it. */
  close(): void {
    this.torndown = true;
    this.clearCloseFallback();
    this.resolveIce([]);
    const conn = this.conn;
    if (conn && !conn.done) {
      this.finish(conn);
      try {
        conn.socket.close();
      } catch {
        // Already closing.
      }
    }
  }

  private inRoom(): boolean {
    return this.view.state === 'admitted' || this.view.state === 'host-disconnected';
  }

  private open(): void {
    const conn: Conn = { socket: new this.deps.WebSocket(this.deps.url), opened: false, done: false, ping: null, pongTimeout: null, watchdog: null };
    this.conn = conn;
    this.listen(conn);
    this.setView({ state: 'connecting', closeCode: null, error: null });
  }

  private listen(conn: Conn): void {
    const current = () => this.conn === conn && !conn.done && !this.torndown;
    conn.socket.addEventListener('open', () => {
      if (!current()) return;
      conn.opened = true;
      this.armPongTimeout(conn);
      conn.ping = this.deps.setInterval(() => this.send(conn, 'ping'), PING_INTERVAL_MS);
    });
    conn.socket.addEventListener('message', (event: MessageEvent) => {
      if (!current() || typeof event.data !== 'string') return;
      if (event.data === 'pong') {
        this.armPongTimeout(conn);
        return;
      }
      this.onFrame(conn, event.data);
    });
    conn.socket.addEventListener('error', () => {
      // An error after `open` is always followed by `close`, which settles it.
      if (!current() || conn.opened) return;
      this.finish(conn);
      this.preOpenFailure();
    });
    conn.socket.addEventListener('close', (event: CloseEvent) => {
      if (!current()) return;
      this.finish(conn);
      if (this.restarting) {
        this.reopen();
        return;
      }
      if (this.leaving) {
        this.leaving = false;
        this.clearCloseFallback();
        this.setView({ state: 'left', closeCode: event.code });
        return;
      }
      if (!conn.opened) {
        this.preOpenFailure();
        return;
      }
      const state = CLOSE_STATES.get(event.code);
      if (state) this.setView({ state, closeCode: event.code });
      else this.setView({ state: 'disconnected', closeCode: event.code, error: 'connection_lost' });
    });
  }

  private onFrame(conn: Conn, text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as ServiceToViewerFrame;
    if (frame.type === 'status') {
      if (frame.status === 'lobby') this.setView({ state: 'lobby' });
      else if (frame.status === 'admitted') {
        this.setView({ state: 'admitted', contributor: frame.contributor === true });
        void this.fetchIceServers();
        this.armWatchdog(conn);
      } else if (frame.status === 'host-disconnected') this.setView({ state: 'host-disconnected' });
      else if (frame.status === 'host-reconnected') this.setView({ state: 'admitted' });
    } else if (frame.type === 'signal' && typeof frame.data === 'object' && frame.data !== null) {
      if (!this.inRoom()) return;
      if (frame.data.sdp?.type === 'offer') {
        this.clearWatchdog(conn);
        this.watchdogRestarts = 0;
      }
      this.callbacks.onSignal(frame.data);
    } else if (frame.type === 'ice-servers' && Array.isArray(frame.iceServers)) {
      this.iceCache = { iceServers: [...frame.iceServers], at: this.deps.now() };
      this.resolveIce(this.iceCache.iceServers);
    } else if (frame.type === 'error' && frame.code === 'turn_unavailable') {
      this.resolveIce([]);
    }
    // Unknown types are ignored.
  }

  private restart(): void {
    const conn = this.conn;
    this.leaving = false;
    this.restarting = true;
    // Waiters belong to the old socket; the new one requests ICE again once admitted.
    this.resolveIce([]);
    if (!conn || conn.done) {
      this.reopen();
      return;
    }
    if (conn.socket.readyState !== OPEN) {
      this.finish(conn);
      try {
        conn.socket.close();
      } catch {
        // Already closing.
      }
      this.reopen();
      return;
    }
    // The close timers stop now; the new socket opens only from this socket's close event or the fallback.
    this.stopTimers(conn);
    try {
      conn.socket.close(1000, 'reconnect');
    } catch {
      // The fallback below opens the next socket anyway.
    }
    this.armCloseFallback(() => {
      this.finish(conn);
      this.reopen();
    });
  }

  private reopen(): void {
    this.restarting = false;
    this.clearCloseFallback();
    this.resolveIce([]);
    this.open();
  }

  private preOpenFailure(): void {
    this.setView({ state: 'disconnected', error: 'unreachable' });
    if (!this.torndown) this.callbacks.onPreOpenFailure();
  }

  private armPongTimeout(conn: Conn): void {
    if (conn.pongTimeout !== null) this.deps.clearTimeout(conn.pongTimeout);
    conn.pongTimeout = this.deps.setTimeout(() => {
      if (this.conn !== conn || conn.done) return;
      this.finish(conn);
      try {
        conn.socket.close();
      } catch {
        // Already closing.
      }
      this.setView({ state: 'disconnected', error: 'connection_lost' });
    }, PONG_TIMEOUT_MS);
  }

  private armWatchdog(conn: Conn): void {
    this.clearWatchdog(conn);
    conn.watchdog = this.deps.setTimeout(() => {
      conn.watchdog = null;
      if (this.conn !== conn || conn.done || this.view.state !== 'admitted') return;
      if (this.watchdogRestarts >= 1) return;
      this.watchdogRestarts += 1;
      this.restart();
    }, OFFER_WATCHDOG_MS);
  }

  private clearWatchdog(conn: Conn): void {
    if (conn.watchdog !== null) this.deps.clearTimeout(conn.watchdog);
    conn.watchdog = null;
  }

  private armCloseFallback(run: () => void): void {
    this.clearCloseFallback();
    this.closeFallback = this.deps.setTimeout(() => {
      this.closeFallback = null;
      run();
    }, CLOSE_FALLBACK_MS);
  }

  private clearCloseFallback(): void {
    if (this.closeFallback !== null) this.deps.clearTimeout(this.closeFallback);
    this.closeFallback = null;
  }

  private stopTimers(conn: Conn): void {
    if (conn.ping !== null) this.deps.clearInterval(conn.ping);
    if (conn.pongTimeout !== null) this.deps.clearTimeout(conn.pongTimeout);
    conn.ping = null;
    conn.pongTimeout = null;
    this.clearWatchdog(conn);
  }

  /** Marks a socket finished: its events are ignored from now on. */
  private finish(conn: Conn): void {
    conn.done = true;
    this.stopTimers(conn);
  }

  private resolveIce(iceServers: readonly IceServer[]): void {
    const pending = this.icePending;
    if (!pending) return;
    this.icePending = null;
    this.deps.clearTimeout(pending.timer);
    pending.resolve(iceServers);
  }

  private send(conn: Conn, text: string): void {
    if (conn.done || conn.socket.readyState !== OPEN) return;
    try {
      conn.socket.send(text);
    } catch {
      // A failing socket reports itself through its close event.
    }
  }

  private setView(patch: Partial<BrowserJoinView>): void {
    this.view = { ...this.view, ...patch };
    if (!this.torndown) this.callbacks.onView({ ...this.view });
  }
}
