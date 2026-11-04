/**
 * The viewer side of Shared Sessions in the dashboard server (PRD PAN-4475 WI-3, WI-4).
 *
 * `JoinManager` opens one join socket per short code (`GET /v1/rooms/:code/join?v=1`,
 * `Authorization: Bearer <device token>`) when the viewer browser posts a join intent (D-1), maps
 * every service status frame, close code and upgrade refusal to one `JoinState` (D-18), and relays
 * WebRTC signaling between the share service and the one viewer-browser subscriber (D-4). The
 * browser only ever sees `JoinView`s and `JoinEvent`s, which have no device token by construction
 * (NFR-1).
 *
 * Subscriber (D-4, D-6): one viewer-browser event stream per join; a new one replaces the old one.
 * A `signal` frame goes to the subscriber, or into a per-generation buffer flushed to the next one.
 * A second subscriber on an admitted join restarts the socket (D-5): a plain close, then a new socket
 * only from the old one's `close` event, so the service flips `connected` and the host offers again.
 * A live join with no subscriber for 60 s is closed and becomes `away` (D-7).
 *
 * Keepalive copies `share-host.ts`: a protocol ping every 30 s; 75 s without a pong terminates the
 * socket. A seated join reconnects after an unexpected close on `SHARE_RECONNECT_DELAYS_MS` and is
 * `reconnecting` meanwhile; a join that never got a status frame becomes `disconnected` (PAN-4479).
 *
 * Plain async class with injected seams, like `share-host.ts` (slice-2 D-8). Nothing here logs.
 */
import type { IceServer, JoinEvent, JoinState, JoinView, ServiceToViewerFrame, SignalData, ViewerFrame } from '@overdeck/contracts';
import { WebSocket } from 'ws';

import { readAccount, type AccountRecord } from '../../../lib/account/store.js';
import { joinSocketUrl, readShareUrl, type ShareUrlResult } from '../../../lib/sharing/share-service.js';
import {
  defaultOpenSocket,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  SHARE_RECONNECT_DELAYS_MS,
  type ShareSocket,
} from './share-host.js';

export const JOIN_UNSUBSCRIBED_GRACE_MS = 60_000;
export const JOIN_CLOSE_FALLBACK_MS = 5_000;
export const JOIN_ICE_TIMEOUT_MS = 5_000;
export const JOIN_ICE_CACHE_MS = 50 * 60_000;
export const JOIN_MAX_PENDING_SIGNALS = 64;

export interface JoinManagerDeps {
  readAccount(): Promise<AccountRecord | null>;
  readShareUrl(): Promise<ShareUrlResult>;
  openSocket(url: string, headers: Record<string, string>): ShareSocket;
  now(): number;
  /** Reconnect backoff (PAN-4479 D-10); tests pass [0]. Default SHARE_RECONNECT_DELAYS_MS. */
  reconnectDelaysMs?: readonly number[];
}

export type JoinOutcome =
  | { kind: 'created' | 'existing'; view: JoinView }
  | { kind: 'error'; status: 412 | 500; body: { error: string; message?: string } };

/** One join socket. `done` is set once the join stops listening to it. */
interface JoinConnection {
  readonly socket: ShareSocket;
  done: boolean;
}

/** The viewer server's record for one short code. */
interface Join {
  readonly shortCode: string;
  readonly joinUrl: string;
  readonly login: string | null;
  readonly socketUrl: string;
  readonly headers: Record<string, string>;
  conn: JoinConnection;
  state: JoinState;
  contributor: boolean;
  closeCode: number | null;
  error: string | null;
  generation: number;
  subscriber: ((event: JoinEvent) => void) | null;
  /** The current socket generation already had a subscriber: a new one restarts (D-5). */
  subscribedThisGeneration: boolean;
  pendingSignals: SignalData[];
  leaving: boolean;
  restarting: boolean;
  graceClosing: boolean;
  iceCache: { readonly iceServers: IceServer[]; readonly at: number } | null;
  icePending: IcePending | null;
  pingTimer: NodeJS.Timeout | null;
  pongTimer: NodeJS.Timeout | null;
  closeFallbackTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
  /** Got at least one status frame; only a seated join reconnects on its own (PAN-4479 D-7). */
  seated: boolean;
  /** Failed connects since the last status frame; indexes the backoff table. */
  attempt: number;
  retryTimer: NodeJS.Timeout | null;
}

interface IcePending {
  readonly promise: Promise<IceServer[]>;
  readonly resolve: (iceServers: IceServer[]) => void;
  readonly timer: NodeJS.Timeout;
}

const LIVE_STATES: ReadonlySet<JoinState> = new Set(['connecting', 'lobby', 'admitted', 'host-disconnected', 'reconnecting']);

/** Close codes the share service uses, mapped to the join state they end in (State table). */
const CLOSE_STATES: ReadonlyMap<number, JoinState> = new Map([
  [1000, 'left'],
  [4003, 'revoked'],
  [4004, 'ended'],
  [4008, 'replaced'],
  [4009, 'is-host'],
  [4010, 'kicked'],
  [4011, 'revoked'],
  [4013, 'full'],
]);

function isLive(join: Join | undefined): join is Join {
  return join !== undefined && LIVE_STATES.has(join.state);
}

/** Builds a view field by field; the join's headers are never spread into it (NFR-1). */
function viewOf(join: Join): JoinView {
  return {
    shortCode: join.shortCode,
    joinUrl: join.joinUrl,
    state: join.state,
    contributor: join.contributor,
    login: join.login,
    closeCode: join.closeCode,
    error: join.error,
  };
}

export class JoinManager {
  private readonly joins = new Map<string, Join>();
  private readonly inFlight = new Map<string, Promise<JoinOutcome>>();

  constructor(private readonly deps: JoinManagerDeps) {}

  /** Opens the join socket for `shortCode` (already normalized), or returns the live join. */
  async join(shortCode: string): Promise<JoinOutcome> {
    const live = this.joins.get(shortCode);
    if (isLive(live)) return { kind: 'existing', view: viewOf(live) };
    const pending = this.inFlight.get(shortCode);
    if (pending) return pending;
    const run = this.openJoin(shortCode).finally(() => this.inFlight.delete(shortCode));
    this.inFlight.set(shortCode, run);
    return run;
  }

  get(shortCode: string): JoinView | null {
    const join = this.joins.get(shortCode);
    return join ? viewOf(join) : null;
  }

  /** null when no join exists. Emits the current state at once (D-4, D-5, D-6). Returns unsubscribe. */
  subscribe(shortCode: string, listener: (event: JoinEvent) => void): (() => void) | null {
    const join = this.joins.get(shortCode);
    if (!join) return null;
    const previous = join.subscriber;
    join.subscriber = null;
    previous?.({ type: 'replaced' });
    join.subscriber = listener;
    this.clearGrace(join);
    listener({ type: 'state', view: viewOf(join) });
    if ((join.state === 'admitted' || join.state === 'host-disconnected') && join.subscribedThisGeneration) {
      this.restart(join);
    } else {
      const pending = join.pendingSignals;
      join.pendingSignals = [];
      for (const data of pending) listener({ type: 'signal', data });
    }
    join.subscribedThisGeneration = true;
    return () => {
      const entry = this.joins.get(shortCode);
      if (!entry || entry.subscriber !== listener) return;
      entry.subscriber = null;
      if (isLive(entry)) this.armGrace(entry);
    };
  }

  /** Relays the browser's answer or ICE candidate (already rebuilt by the route) to the host. */
  signal(shortCode: string, data: SignalData): 'sent' | 'not_found' | 'not_admitted' {
    const join = this.joins.get(shortCode);
    if (!join) return 'not_found';
    if (join.state !== 'admitted') return 'not_admitted';
    return this.sendFrame(join, { type: 'signal', data }) ? 'sent' : 'not_admitted';
  }

  /** The cached ICE servers, or the answer to a pending or new request; `[]` on timeout (D-9). */
  async iceServers(shortCode: string): Promise<{ ok: true; iceServers: IceServer[] } | { ok: false; reason: 'not_found' | 'not_admitted' }> {
    const join = this.joins.get(shortCode);
    if (!join) return { ok: false, reason: 'not_found' };
    if (join.state !== 'admitted' && join.state !== 'host-disconnected') return { ok: false, reason: 'not_admitted' };
    if (this.freshIce(join)) return { ok: true, iceServers: join.iceCache!.iceServers };
    return { ok: true, iceServers: await this.requestIce(join) };
  }

  /** Sends `leave`; the join becomes `left` on the socket's close, or after the fallback. */
  leave(shortCode: string): 'left' | 'not_found' {
    const join = this.joins.get(shortCode);
    if (!join) return 'not_found';
    const conn = join.conn;
    if (!conn.done && conn.socket.readyState === WebSocket.OPEN) {
      join.leaving = true;
      this.sendFrame(join, { type: 'leave' });
      this.armCloseFallback(join, () => {
        this.finishConnection(join, 'terminate');
        this.setState(join, 'left');
      });
      return 'left';
    }
    this.finishConnection(join, 'terminate');
    this.setState(join, 'left');
    return 'left';
  }

  /** Closes every join socket (tests). */
  stop(): void {
    for (const join of this.joins.values()) {
      this.clearRetry(join);
      this.finishConnection(join, 'close');
      this.resolveIce(join, []);
      join.subscriber = null;
    }
    this.joins.clear();
  }

  private async openJoin(shortCode: string): Promise<JoinOutcome> {
    const base = await this.deps.readShareUrl();
    if ('error' in base) return { kind: 'error', status: 500, body: { error: 'share_url_invalid', message: base.error } };

    let account: AccountRecord | null;
    try {
      account = await this.deps.readAccount();
    } catch (error) {
      return { kind: 'error', status: 500, body: { error: 'account_unreadable', message: (error as Error).message } };
    }
    if (!account) {
      return { kind: 'error', status: 412, body: { error: 'not_signed_in', message: 'Sign in with pan account login to join shared conversations.' } };
    }

    // A previous entry (terminal, away or disconnected) is replaced; its subscriber carries over.
    const previous = this.joins.get(shortCode);
    if (previous) this.finishConnection(previous, 'terminate');
    const subscriber = previous?.subscriber ?? null;

    const socketUrl = joinSocketUrl(base.url, shortCode);
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const join: Join = {
      shortCode,
      joinUrl: `${base.url}/s/${shortCode}`,
      login: account.githubLogin,
      socketUrl,
      headers,
      conn: { socket: this.deps.openSocket(socketUrl, headers), done: false },
      state: 'connecting',
      contributor: false,
      closeCode: null,
      error: null,
      generation: 1,
      subscriber,
      subscribedThisGeneration: subscriber !== null,
      pendingSignals: [],
      leaving: false,
      restarting: false,
      graceClosing: false,
      iceCache: null,
      icePending: null,
      pingTimer: null,
      pongTimer: null,
      closeFallbackTimer: null,
      graceTimer: null,
      seated: false,
      attempt: 0,
      retryTimer: null,
    };
    this.joins.set(shortCode, join);
    this.listen(join, join.conn);
    this.emit(join, { type: 'state', view: viewOf(join) });
    return { kind: 'created', view: viewOf(join) };
  }

  private listen(join: Join, conn: JoinConnection): void {
    const { socket } = conn;
    const current = () => !conn.done && join.conn === conn && this.joins.get(join.shortCode) === join;

    socket.on('open', () => {
      if (current()) this.startKeepalive(join, conn);
    });
    socket.on('message', (data, isBinary) => {
      if (current() && !isBinary) this.onFrame(join, data.toString());
    });
    socket.on('pong', () => {
      if (current()) this.armPongDeadline(join, conn);
    });
    socket.on('unexpected-response', (_req, res) => {
      if (!current()) return;
      const status = res.statusCode ?? 0;
      this.finishConnection(join, 'terminate');
      if (status === 404) this.setState(join, 'ended');
      else if (status === 401 || status === 403) this.setState(join, 'rejected');
      else this.lose(join, `http_${status}`);
    });
    socket.on('close', (code) => {
      if (!current()) return;
      this.finishConnection(join, 'none');
      join.closeCode = code;
      if (this.settleIntent(join)) return;
      const state = CLOSE_STATES.get(code);
      if (state) this.setState(join, state);
      else this.lose(join, 'connection_lost');
    });
    socket.on('error', () => {
      if (!current()) return;
      this.finishConnection(join, 'terminate');
      if (!this.settleIntent(join)) this.lose(join, 'unreachable');
    });
  }

  private onFrame(join: Join, text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as ServiceToViewerFrame;
    if (frame.type === 'status') {
      join.seated = true;
      join.attempt = 0;
      if (frame.status === 'lobby') this.setState(join, 'lobby');
      else if (frame.status === 'admitted') {
        join.contributor = frame.contributor === true;
        this.setState(join, 'admitted');
        if (!this.freshIce(join) && !join.icePending) void this.requestIce(join);
      } else if (frame.status === 'host-disconnected') this.setState(join, 'host-disconnected');
      else if (frame.status === 'host-reconnected') this.setState(join, 'admitted');
    } else if (frame.type === 'signal' && typeof frame.data === 'object' && frame.data !== null) {
      // The service relays signals only to admitted viewers; a lobby join never emits one (FR-3).
      if (join.state !== 'admitted' && join.state !== 'host-disconnected') return;
      if (join.subscriber) join.subscriber({ type: 'signal', data: frame.data });
      else if (join.pendingSignals.length < JOIN_MAX_PENDING_SIGNALS) join.pendingSignals.push(frame.data);
    } else if (frame.type === 'ice-servers' && Array.isArray(frame.iceServers)) {
      join.iceCache = { iceServers: [...frame.iceServers], at: this.deps.now() };
      this.resolveIce(join, join.iceCache.iceServers);
    } else if (frame.type === 'error' && frame.code === 'turn_unavailable') {
      this.resolveIce(join, []);
    }
    // Unknown types are ignored.
  }

  /** A close or error the manager asked for: restart, leave or grace. False when none applies. */
  private settleIntent(join: Join): boolean {
    if (join.restarting) {
      this.reopen(join);
      return true;
    }
    if (join.leaving) {
      this.setState(join, 'left');
      return true;
    }
    if (join.graceClosing) {
      this.setState(join, 'away');
      return true;
    }
    return false;
  }

  /** D-5: a plain close (never `leave`), then a new socket only from the old one's `close` event. */
  private restart(join: Join): void {
    join.restarting = true;
    const { socket } = join.conn;
    if (socket.readyState !== WebSocket.OPEN) {
      this.finishConnection(join, 'terminate');
      this.reopen(join);
      return;
    }
    try {
      socket.close(1000, 'reconnect');
    } catch {
      // The fallback below terminates it.
    }
    this.armCloseFallback(join, () => {
      this.finishConnection(join, 'terminate');
      this.reopen(join);
    });
  }

  private reopen(join: Join): void {
    join.restarting = false;
    this.openNextSocket(join);
    this.setState(join, 'connecting');
  }

  private openNextSocket(join: Join): void {
    join.generation += 1;
    join.pendingSignals = [];
    join.subscribedThisGeneration = join.subscriber !== null;
    this.resolveIce(join, []);
    join.conn = { socket: this.deps.openSocket(join.socketUrl, join.headers), done: false };
    this.listen(join, join.conn);
  }

  /** An unexpected loss: a seated join reconnects; one that never got a status frame is `disconnected`. */
  private lose(join: Join, error: string): void {
    if (join.seated) this.scheduleReconnect(join, error);
    else this.setState(join, 'disconnected', error);
  }

  private scheduleReconnect(join: Join, error: string): void {
    this.finishConnection(join, 'terminate');
    this.resolveIce(join, []);
    this.clearRetry(join);
    this.setState(join, 'reconnecting', error);
    const delays = this.deps.reconnectDelaysMs ?? SHARE_RECONNECT_DELAYS_MS;
    const delay = delays[Math.min(join.attempt, delays.length - 1)] ?? 0;
    join.attempt += 1;
    join.retryTimer = setTimeout(() => this.reconnectNow(join, error), delay);
    join.retryTimer.unref?.();
  }

  /** Opens the next socket and stays `reconnecting`; the next status frame sets the state. */
  private reconnectNow(join: Join, error: string): void {
    join.retryTimer = null;
    if (this.joins.get(join.shortCode) !== join || join.state !== 'reconnecting') return;
    try {
      this.openNextSocket(join);
    } catch {
      // openSocket threw synchronously: wait for the next slot.
      this.scheduleReconnect(join, error);
    }
  }

  private clearRetry(join: Join): void {
    if (join.retryTimer) clearTimeout(join.retryTimer);
    join.retryTimer = null;
  }

  /** D-7: no subscriber for 60 s closes a live join; it becomes `away`. */
  private armGrace(join: Join): void {
    this.clearGrace(join);
    join.graceTimer = setTimeout(() => {
      join.graceTimer = null;
      if (join.subscriber || !isLive(join) || this.joins.get(join.shortCode) !== join) return;
      if (join.state === 'reconnecting' && join.conn.done) {
        // Waiting between reconnect attempts: stop retrying.
        this.clearRetry(join);
        this.setState(join, 'away');
        return;
      }
      if (join.conn.done) return;
      join.graceClosing = true;
      const { socket } = join.conn;
      if (socket.readyState !== WebSocket.OPEN) {
        this.finishConnection(join, 'terminate');
        this.setState(join, 'away');
        return;
      }
      try {
        socket.close(1000, 'away');
      } catch {
        // The fallback below terminates it.
      }
      this.armCloseFallback(join, () => {
        this.finishConnection(join, 'terminate');
        this.setState(join, 'away');
      });
    }, JOIN_UNSUBSCRIBED_GRACE_MS);
    join.graceTimer.unref?.();
  }

  private clearGrace(join: Join): void {
    if (join.graceTimer) clearTimeout(join.graceTimer);
    join.graceTimer = null;
  }

  private freshIce(join: Join): boolean {
    return join.iceCache !== null && this.deps.now() - join.iceCache.at < JOIN_ICE_CACHE_MS;
  }

  /** Sends one `ice-servers` frame and waits for its answer; `[]` on timeout or a failed send. */
  private requestIce(join: Join): Promise<IceServer[]> {
    if (join.icePending) return join.icePending.promise;
    if (!this.sendFrame(join, { type: 'ice-servers' })) return Promise.resolve([]);
    let resolve!: (iceServers: IceServer[]) => void;
    const promise = new Promise<IceServer[]>((r) => { resolve = r; });
    const timer = setTimeout(() => this.resolveIce(join, []), JOIN_ICE_TIMEOUT_MS);
    timer.unref?.();
    join.icePending = { promise, resolve, timer };
    return promise;
  }

  private resolveIce(join: Join, iceServers: IceServer[]): void {
    const pending = join.icePending;
    if (!pending) return;
    join.icePending = null;
    clearTimeout(pending.timer);
    pending.resolve(iceServers);
  }

  private sendFrame(join: Join, frame: ViewerFrame): boolean {
    if (join.conn.done || join.conn.socket.readyState !== WebSocket.OPEN) return false;
    try {
      join.conn.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  private setState(join: Join, state: JoinState, error: string | null = null): void {
    join.state = state;
    join.error = error;
    if (!LIVE_STATES.has(state)) {
      this.stopTimers(join);
      this.clearGrace(join);
      this.clearRetry(join);
      this.resolveIce(join, []);
    }
    this.emit(join, { type: 'state', view: viewOf(join) });
  }

  private emit(join: Join, event: JoinEvent): void {
    join.subscriber?.(event);
  }

  private startKeepalive(join: Join, conn: JoinConnection): void {
    this.armPongDeadline(join, conn);
    join.pingTimer = setInterval(() => {
      try {
        conn.socket.ping();
      } catch {
        // The close handler settles the join.
      }
    }, PING_INTERVAL_MS);
    join.pingTimer.unref?.();
  }

  private armPongDeadline(join: Join, conn: JoinConnection): void {
    if (join.pongTimer) clearTimeout(join.pongTimer);
    join.pongTimer = setTimeout(() => {
      if (conn.done || join.conn !== conn) return;
      this.finishConnection(join, 'terminate');
      this.lose(join, 'connection_lost');
    }, PONG_TIMEOUT_MS);
    join.pongTimer.unref?.();
  }

  private armCloseFallback(join: Join, onFire: () => void): void {
    if (join.closeFallbackTimer) clearTimeout(join.closeFallbackTimer);
    const conn = join.conn;
    join.closeFallbackTimer = setTimeout(() => {
      join.closeFallbackTimer = null;
      if (!conn.done && join.conn === conn) onFire();
    }, JOIN_CLOSE_FALLBACK_MS);
    join.closeFallbackTimer.unref?.();
  }

  private stopKeepalive(join: Join): void {
    if (join.pingTimer) clearInterval(join.pingTimer);
    if (join.pongTimer) clearTimeout(join.pongTimer);
    join.pingTimer = null;
    join.pongTimer = null;
  }

  private stopTimers(join: Join): void {
    this.stopKeepalive(join);
    if (join.closeFallbackTimer) clearTimeout(join.closeFallbackTimer);
    join.closeFallbackTimer = null;
  }

  /** Stops listening to the join's current socket and shuts it. */
  private finishConnection(join: Join, how: 'close' | 'terminate' | 'none'): void {
    const conn = join.conn;
    if (conn.done) return;
    conn.done = true;
    this.stopTimers(join);
    if (how === 'none') return;
    try {
      if (how === 'terminate') conn.socket.terminate();
      else if (conn.socket.readyState === WebSocket.OPEN || conn.socket.readyState === WebSocket.CONNECTING) conn.socket.close(1000);
    } catch {
      // Already closed.
    }
  }
}

export function defaultJoinDeps(): JoinManagerDeps {
  return { readAccount, readShareUrl, openSocket: defaultOpenSocket, now: () => Date.now() };
}

let manager: JoinManager | null = null;

/** The process-wide manager, created on first use with production deps. */
export function getJoinManager(): JoinManager {
  manager ??= new JoinManager(defaultJoinDeps());
  return manager;
}

export function setJoinManagerForTests(next: JoinManager | null): void {
  manager = next;
}
