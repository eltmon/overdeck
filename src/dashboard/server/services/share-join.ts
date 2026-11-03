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
 * Keepalive copies `share-host.ts`: a protocol ping every 30 s; 75 s without a pong terminates the
 * socket and the join becomes `disconnected`. An unexpected close is never reconnected here (D-8;
 * slice 8, PAN-4479, adds automatic restore).
 *
 * Plain async class with injected seams, like `share-host.ts` (slice-2 D-8). Nothing here logs.
 */
import type { JoinEvent, JoinState, JoinView, ServiceToViewerFrame, SignalData } from '@overdeck/contracts';
import { WebSocket } from 'ws';

import { readAccount, type AccountRecord } from '../../../lib/account/store.js';
import { joinSocketUrl, readShareUrl, type ShareUrlResult } from '../../../lib/sharing/share-service.js';
import { defaultOpenSocket, PING_INTERVAL_MS, PONG_TIMEOUT_MS, type ShareSocket } from './share-host.js';

export const JOIN_CLOSE_FALLBACK_MS = 5_000;

export interface JoinManagerDeps {
  readAccount(): Promise<AccountRecord | null>;
  readShareUrl(): Promise<ShareUrlResult>;
  openSocket(url: string, headers: Record<string, string>): ShareSocket;
  now(): number;
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
  readonly login: string;
  readonly socketUrl: string;
  readonly headers: Record<string, string>;
  conn: JoinConnection;
  state: JoinState;
  contributor: boolean;
  closeCode: number | null;
  error: string | null;
  generation: number;
  subscriber: ((event: JoinEvent) => void) | null;
  leaving: boolean;
  pingTimer: NodeJS.Timeout | null;
  pongTimer: NodeJS.Timeout | null;
  closeFallbackTimer: NodeJS.Timeout | null;
}

const LIVE_STATES: ReadonlySet<JoinState> = new Set(['connecting', 'lobby', 'admitted', 'host-disconnected']);

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

  /** Sends `leave`; the join becomes `left` on the socket's close, or after the fallback. */
  leave(shortCode: string): 'left' | 'not_found' {
    const join = this.joins.get(shortCode);
    if (!join) return 'not_found';
    const conn = join.conn;
    if (!conn.done && conn.socket.readyState === WebSocket.OPEN) {
      join.leaving = true;
      try {
        conn.socket.send(JSON.stringify({ type: 'leave' }));
      } catch {
        // The close handler or the fallback settles the join.
      }
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
      this.finishConnection(join, 'close');
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
      leaving: false,
      pingTimer: null,
      pongTimer: null,
      closeFallbackTimer: null,
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
      else this.setState(join, 'disconnected', `http_${status}`);
    });
    socket.on('close', (code) => {
      if (!current()) return;
      this.finishConnection(join, 'none');
      join.closeCode = code;
      if (join.leaving) this.setState(join, 'left');
      else {
        const state = CLOSE_STATES.get(code);
        if (state) this.setState(join, state);
        else this.setState(join, 'disconnected', 'connection_lost');
      }
    });
    socket.on('error', () => {
      if (!current()) return;
      this.finishConnection(join, 'terminate');
      this.setState(join, 'disconnected', 'unreachable');
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
      if (frame.status === 'lobby') this.setState(join, 'lobby');
      else if (frame.status === 'admitted') {
        join.contributor = frame.contributor === true;
        this.setState(join, 'admitted');
      } else if (frame.status === 'host-disconnected') this.setState(join, 'host-disconnected');
      else if (frame.status === 'host-reconnected') this.setState(join, 'admitted');
    }
    // Unknown types are ignored.
  }

  private setState(join: Join, state: JoinState, error: string | null = null): void {
    join.state = state;
    join.error = error;
    if (!LIVE_STATES.has(state)) this.stopTimers(join);
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
      this.setState(join, 'disconnected', 'connection_lost');
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
