/**
 * The host side of Shared Sessions in the dashboard server (PRD PAN-4473 WI-4).
 *
 * `ShareManager` creates rooms on the share service, keeps each room's host token in
 * `${OVERDECK_HOME}/shared-sessions.json` (`src/lib/sharing/share-record.ts`), holds one host
 * WebSocket per live room (`GET /v1/rooms/:code/host?v=1`, `Authorization: Bearer <hostToken>`),
 * keeps the latest `room` snapshot in memory, and relays the browser's share commands as host
 * frames. The browser only ever sees `ShareView`s, which have no host token by construction.
 *
 * Lifecycle: the host socket opens right after the room is created and its record written, and
 * `resume()` re-parks every record on boot (PAN-4479). An unexpected loss reconnects on `SHARE_RECONNECT_DELAYS_MS` and keeps the hub (PAN-4479); close
 * 4004 or a 404/401 upgrade removes the record; close 4008 stops (another host socket holds the room).
 *
 * Keepalive (D-11): a WebSocket protocol ping every 30 s; 75 s without a pong terminates the
 * socket and reconnects.
 *
 * WebRTC (PAN-4474): each live host gets a `PeerHub` (`../sharing/peer-hub.ts`). The manager routes
 * `signal`, `ice-servers` and `error turn_unavailable` frames to it, tells it about every `admit`,
 * `kick` and `revoke` it sends, and closes it when the host entry is dropped. A dropped host socket
 * keeps established peer connections.
 *
 * Prompts (PAN-4476): every view carries the hub's drafts and queue, and `sendPrompt` queues a
 * controller send through the live hub (D-1).
 *
 * Control (PAN-4478): `command` and `sendPrompt` pass the data owner through `controlRefusal`; while a
 * viewer controls, everything except reclaim answers 409 `not_controller`. `set-controller` is
 * mirrored to the hub's appointment, and every view carries the hub's effective controller.
 *
 * Plain async class with injected seams, like `directory-client.ts` (D-8). Nothing here logs.
 */
import type {
  HostFrame,
  RoomSnapshot,
  SendSharePromptRequest,
  ServiceToHostFrame,
  ShareCommand,
  ShareConnection,
  ShareLastError,
  ShareScope,
  ShareView,
} from '@overdeck/contracts';
import { type RawData, WebSocket } from 'ws';

import { readAccount, type AccountRecord } from '../../../lib/account/store.js';
import {
  putShareRecord,
  readShareRecords,
  removeShareRecord,
  type ShareRecord,
} from '../../../lib/sharing/share-record.js';
import {
  createRoom,
  deleteRoom,
  hostSocketUrl,
  readShareUrl,
  type ShareUrlResult,
} from '../../../lib/sharing/share-service.js';
import { controlRefusal, type ControlRefusal } from '../sharing/controller.js';
import { PeerHub, productionPeerHubDeps, type HostHub, type PeerHubContext } from '../sharing/peer-hub.js';

export const PING_INTERVAL_MS = 30_000;
export const PONG_TIMEOUT_MS = 75_000;
/** Reconnect backoff (PAN-4479 D-2): attempt n waits table[min(n, last)]; a `room` frame resets n. */
export const SHARE_RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/** The part of a `ws` WebSocket the host uses; tests supply a fake. */
export interface ShareSocket {
  readonly readyState: number;
  on(event: 'open', listener: () => void): unknown;
  on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): unknown;
  on(event: 'unexpected-response', listener: (req: unknown, res: { statusCode?: number }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'pong', listener: () => void): unknown;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface ShareManagerDeps {
  readAccount(): Promise<AccountRecord | null>;
  readShareUrl(): Promise<ShareUrlResult>;
  createRoom: typeof createRoom;
  deleteRoom: typeof deleteRoom;
  records: { read: typeof readShareRecords; put: typeof putShareRecord; remove: typeof removeShareRecord };
  openSocket(url: string, headers: Record<string, string>): ShareSocket;
  now(): Date;
  /** Builds the share's WebRTC hub (PAN-4474). Absent: no hub, signaling frames are ignored. */
  createHub?(ctx: PeerHubContext): HostHub;
  /** Reconnect backoff (D-2); tests pass [0]. Default SHARE_RECONNECT_DELAYS_MS. */
  reconnectDelaysMs?: readonly number[];
}

export type CreateShareOutcome =
  | { kind: 'created'; view: ShareView }
  | { kind: 'existing'; view: ShareView }
  | { kind: 'error'; status: number; body: { error: string; message?: string } };

/** One host socket; `done` is set once the manager stops listening to it. */
interface HostConnection {
  readonly socket: ShareSocket;
  done: boolean;
}

/** One room hosted by this process, across host-socket reconnects. */
interface ShareHost {
  readonly shortCode: string;
  readonly record: ShareRecord;
  /** Share service URL used for every (re)connect. */
  readonly base: string;
  conn: HostConnection;
  connection: ShareConnection;
  snapshot: RoomSnapshot | null;
  lastError: ShareLastError | null;
  pingTimer: NodeJS.Timeout | null;
  pongTimer: NodeJS.Timeout | null;
  retryTimer: NodeJS.Timeout | null;
  /** Failed connects since the last `room` frame; indexes the backoff table. */
  attempt: number;
  /** Re-parked by resume() and no `room` frame yet: the first one seeds the hub (D-4). */
  restoring: boolean;
  hub: HostHub | null;
}

const CLOSE_ROOM_ENDED = 4004;
/** The 409 messages of a controller-gate refusal (PRD PAN-4478 D-12). */
const REFUSAL_MESSAGES: Record<ControlRefusal, string> = {
  not_controller: 'Another participant has control. Reclaim control first.',
  unknown_participant: 'That person is not in the room.',
  invalid_target: 'The host refused that action.',
  invalid_command: 'The host refused that action.',
};
const CLOSE_REPLACED = 4008;

function scopeKey(kind: string, id: string): string {
  return `${kind}\n${id}`;
}

function isLive(host: ShareHost | undefined): host is ShareHost {
  return host !== undefined && host.connection !== 'disconnected';
}

/** Builds a view field by field; a record is never spread into it (NFR-1). */
function viewOf(shortCode: string, record: ShareRecord, host: ShareHost | undefined): ShareView {
  const controllerGithubId = host?.hub?.controllerGithubId() ?? host?.snapshot?.controllerGithubId;
  return {
    shortCode,
    joinUrl: record.joinUrl,
    scope: { kind: 'conversation', conversationId: record.scopeId },
    createdAt: record.createdAt,
    connection: host ? host.connection : 'disconnected',
    snapshot: host ? host.snapshot : null,
    lastError: host ? host.lastError : null,
    drafts: host?.hub?.draftsView() ?? [],
    queue: host?.hub?.queueView() ?? { agentWorking: false, delivering: false, items: [] },
    ...(controllerGithubId === undefined || controllerGithubId === null ? {} : { controllerGithubId }),
  };
}

/** Rebuilds a command from its known keys only, so nothing else reaches the share service. */
function frameOf(command: ShareCommand): ShareCommand {
  switch (command.type) {
    case 'admit':
      return command.contributor === undefined
        ? { type: 'admit', githubId: command.githubId }
        : { type: 'admit', githubId: command.githubId, contributor: command.contributor };
    case 'kick':
      return { type: 'kick', githubId: command.githubId };
    case 'revoke':
      return { type: 'revoke', githubId: command.githubId };
    case 'unrevoke':
      return { type: 'unrevoke', githubId: command.githubId };
    case 'set-contributor':
      return { type: 'set-contributor', githubId: command.githubId, contributor: command.contributor };
    case 'set-controller':
      return { type: 'set-controller', githubId: command.githubId };
  }
}

function createFailure(status: number | null, error: string): CreateShareOutcome {
  if (status === 401) {
    return { kind: 'error', status: 409, body: { error: 'account_rejected', message: 'overdeck.ai rejected this sign-in; run pan account login' } };
  }
  if (status === 403) {
    return { kind: 'error', status: 409, body: { error: 'account_expired', message: 'overdeck.ai access for this account has expired' } };
  }
  if (status === 429) return { kind: 'error', status: 429, body: { error: 'rate_limited' } };
  if (status === null) return { kind: 'error', status: 502, body: { error: 'share_service_unreachable', message: error } };
  return { kind: 'error', status: 502, body: { error: 'share_service_error', message: error } };
}

export class ShareManager {
  private readonly hosts = new Map<string, ShareHost>();
  private readonly inFlight = new Map<string, Promise<CreateShareOutcome>>();
  /** Record removals started by socket events; `list()` waits for them so it never shows a removed share. */
  private readonly removals = new Set<Promise<unknown>>();

  constructor(private readonly deps: ShareManagerDeps) {}

  async create(scope: ShareScope): Promise<CreateShareOutcome> {
    const key = scopeKey(scope.kind, scope.conversationId);
    const live = this.liveHostFor(key);
    if (live) return { kind: 'existing', view: viewOf(live.shortCode, live.record, live) };
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const run = this.createRoomFor(scope).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    return run;
  }

  async list(): Promise<ShareView[]> {
    await Promise.all([...this.removals]);
    const records = await this.deps.records.read();
    return Object.entries(records)
      .sort(([, a], [, b]) => a.createdAt.localeCompare(b.createdAt))
      .map(([code, record]) => viewOf(code, record, this.hosts.get(code)));
  }

  async command(shortCode: string, command: ShareCommand): Promise<{ status: 202 | 404 | 409; body: object }> {
    const records = await this.deps.records.read();
    if (!(shortCode in records)) return { status: 404, body: { error: 'share_not_found' } };
    const host = this.hosts.get(shortCode);
    if (!host || host.connection !== 'connected') return { status: 409, body: { error: 'share_not_connected' } };
    const snapshot = host.snapshot;
    if (!snapshot) return { status: 409, body: { error: 'share_not_connected' } };
    const refusal = controlRefusal({
      snapshot,
      controllerGithubId: host.hub?.controllerGithubId() ?? snapshot.controllerGithubId,
      actor: { kind: 'owner' },
      command,
      isHostAdmitted: (githubId) => host.hub?.isHostAdmitted(githubId) ?? true,
    });
    if (refusal) return { status: 409, body: { error: refusal, message: REFUSAL_MESSAGES[refusal] } };
    try {
      host.conn.socket.send(JSON.stringify(frameOf(command)));
    } catch {
      return { status: 409, body: { error: 'share_not_connected' } };
    }
    if (command.type === 'admit') host.hub?.admit(command.githubId);
    else if (command.type === 'kick' || command.type === 'revoke') host.hub?.remove(command.githubId);
    else if (command.type === 'set-controller') host.hub?.appoint(command.githubId);
    return { status: 202, body: { ok: true } };
  }

  /** Queues a controller send on the share's live hub (PAN-4476 FR-13). */
  async sendPrompt(
    shortCode: string,
    body: SendSharePromptRequest,
  ): Promise<{ status: 202 | 400 | 404 | 409 | 429; body: object }> {
    const records = await this.deps.records.read();
    if (!(shortCode in records)) return { status: 404, body: { error: 'share_not_found' } };
    const host = this.hosts.get(shortCode);
    if (!host?.hub) return { status: 409, body: { error: 'share_not_live' } };
    const controller = host.hub.controllerGithubId();
    const owner = host.snapshot?.dataOwner ?? null;
    if (controller !== null && owner !== null && controller !== owner.githubId) {
      return { status: 409, body: { error: 'not_controller', message: REFUSAL_MESSAGES.not_controller } };
    }
    const result = host.hub.sendFromController(body, host.snapshot?.dataOwner ?? null);
    if (result.ok) return { status: 202, body: { ok: true, position: result.position } };
    return { status: result.reason === 'queue_full' ? 429 : 400, body: { error: result.reason } };
  }

  async end(shortCode: string): Promise<{ status: 204 | 404 | 500 | 502; body?: object }> {
    const records = await this.deps.records.read();
    const record = records[shortCode];
    if (!record) return { status: 404, body: { error: 'share_not_found' } };
    // A share that is not connected is forgotten locally when the service cannot be reached; the
    // room, if it still exists, ends on the service's 5-minute alarm (D-12).
    const offline = this.hosts.get(shortCode)?.connection !== 'connected';
    const base = await this.deps.readShareUrl();
    if ('error' in base) {
      if (offline) return this.forget(shortCode);
      return { status: 500, body: { error: 'share_url_invalid', message: base.error } };
    }
    const deleted = await this.deps.deleteRoom(base.url, shortCode, record.hostToken);
    if (!deleted.ok) {
      if (offline) return this.forget(shortCode);
      return { status: 502, body: { error: 'share_service_error', message: deleted.error } };
    }
    return this.forget(shortCode);
  }

  private async forget(shortCode: string): Promise<{ status: 204 }> {
    this.dropHost(shortCode, 'close');
    await this.deps.records.remove(shortCode);
    return { status: 204 };
  }

  /**
   * Re-parks every recorded share this process does not host yet (D-3). Reads the record file and
   * anywhere.share_url only; never throws. Returns the short codes it opened.
   */
  async resume(): Promise<string[]> {
    let records: Record<string, ShareRecord>;
    try {
      records = await this.deps.records.read();
    } catch {
      return [];
    }
    const codes = Object.keys(records).filter((code) => !this.hosts.has(code));
    if (codes.length === 0) return [];
    let base: ShareUrlResult;
    try {
      base = await this.deps.readShareUrl();
    } catch {
      return [];
    }
    if ('error' in base) return [];
    const opened: string[] = [];
    for (const code of codes) {
      try {
        this.openHost(base.url, code, records[code] as ShareRecord, true);
        opened.push(code);
      } catch {
        // openSocket or createHub threw synchronously: forget this entry and shut any socket it
        // opened (it has no listeners yet), keep the record.
        this.dropHost(code, 'terminate');
      }
    }
    return opened;
  }

  /** Closes every host socket (tests and shutdown). Records stay on disk. */
  stop(): void {
    for (const code of [...this.hosts.keys()]) this.dropHost(code, 'close');
  }

  private liveHostFor(key: string): ShareHost | undefined {
    for (const host of this.hosts.values()) {
      if (isLive(host) && scopeKey(host.record.scopeKind, host.record.scopeId) === key) return host;
    }
    return undefined;
  }

  private async createRoomFor(scope: ShareScope): Promise<CreateShareOutcome> {
    const base = await this.deps.readShareUrl();
    if ('error' in base) return { kind: 'error', status: 500, body: { error: 'share_url_invalid', message: base.error } };

    let account: AccountRecord | null;
    try {
      account = await this.deps.readAccount();
    } catch (error) {
      return { kind: 'error', status: 500, body: { error: 'account_unreadable', message: (error as Error).message } };
    }
    if (!account) {
      return { kind: 'error', status: 412, body: { error: 'not_signed_in', message: 'Sign in with pan account login to share conversations.' } };
    }

    let records: Record<string, ShareRecord>;
    try {
      records = await this.deps.records.read();
    } catch (error) {
      return { kind: 'error', status: 500, body: { error: 'share_record_unreadable', message: (error as Error).message } };
    }
    for (const [code, record] of Object.entries(records)) {
      if (record.scopeKind !== scope.kind || record.scopeId !== scope.conversationId) continue;
      // A stale record for this conversation (D-3): end it best-effort, then forget it.
      this.dropHost(code, 'close');
      await this.deps.deleteRoom(base.url, code, record.hostToken).catch(() => undefined);
      await this.deps.records.remove(code);
    }

    const created = await this.deps.createRoom(base.url, account.accessToken, scope);
    if (!created.ok) return createFailure(created.status, created.error);
    const { room } = created;

    const record: ShareRecord = {
      scopeKind: 'conversation',
      scopeId: scope.conversationId,
      hostToken: room.hostToken,
      joinUrl: room.joinUrl,
      createdAt: this.deps.now().toISOString(),
    };
    try {
      await this.deps.records.put(room.shortCode, record);
    } catch (error) {
      await this.deps.deleteRoom(base.url, room.shortCode, room.hostToken).catch(() => undefined);
      return { kind: 'error', status: 500, body: { error: 'share_record_unwritable', message: (error as Error).message } };
    }

    const host = this.openHost(base.url, room.shortCode, record, false);
    host.snapshot = room.snapshot;
    return { kind: 'created', view: viewOf(room.shortCode, record, host) };
  }

  private openHost(base: string, shortCode: string, record: ShareRecord, restoring: boolean): ShareHost {
    const host: ShareHost = {
      shortCode,
      record,
      base,
      conn: this.openConnection(base, shortCode, record),
      connection: 'connecting',
      snapshot: null,
      lastError: null,
      pingTimer: null,
      pongTimer: null,
      retryTimer: null,
      attempt: 0,
      restoring,
      hub: null,
    };
    this.hosts.set(shortCode, host);
    host.hub = this.deps.createHub?.({
      shortCode,
      scope: { kind: 'conversation', conversationId: record.scopeId },
      sendFrame: (frame) => this.sendHostFrame(host, frame),
    }) ?? null;
    this.listen(host, host.conn);
    return host;
  }

  private openConnection(base: string, shortCode: string, record: ShareRecord): HostConnection {
    const socket = this.deps.openSocket(hostSocketUrl(base, shortCode), { Authorization: `Bearer ${record.hostToken}` });
    return { socket, done: false };
  }

  /** Opens the next host socket for an existing entry; the hub and snapshot are kept (D-1). */
  private connect(host: ShareHost): void {
    host.conn = this.openConnection(host.base, host.shortCode, host.record);
    this.listen(host, host.conn);
  }

  private listen(host: ShareHost, conn: HostConnection): void {
    const { shortCode } = host;
    // A replaced or abandoned socket's late events change nothing (H-1).
    const current = () => !conn.done && host.conn === conn && this.hosts.get(shortCode) === host;
    const { socket } = conn;

    socket.on('open', () => {
      if (current()) this.startKeepalive(host, conn);
    });
    socket.on('message', (data, isBinary) => {
      if (current() && !isBinary) this.onFrame(host, data.toString());
    });
    socket.on('pong', () => {
      if (current()) this.armPongDeadline(host, conn);
    });
    socket.on('unexpected-response', (_req, res) => {
      if (!current()) return;
      const status = res.statusCode ?? 0;
      if (status === 404 || status === 401) {
        // The room is gone or its token is no longer valid.
        this.dropHost(shortCode, 'terminate');
        this.removeRecord(shortCode);
      } else {
        this.lose(host, 'terminate');
      }
    });
    socket.on('close', (code) => {
      if (!current()) return;
      if (code === CLOSE_ROOM_ENDED) {
        this.dropHost(shortCode, 'none');
        this.removeRecord(shortCode);
      } else if (code === CLOSE_REPLACED) {
        // Another host socket holds the room; retrying would replace it back (D-5).
        conn.done = true;
        this.stopKeepalive(host);
        host.connection = 'disconnected';
        host.lastError = { code: 'replaced', at: this.deps.now().toISOString() };
      } else {
        this.lose(host, 'none');
      }
    });
    socket.on('error', () => {
      if (current()) this.lose(host, 'terminate');
    });
  }

  private onFrame(host: ShareHost, text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as ServiceToHostFrame;
    if (frame.type === 'room' && typeof frame.snapshot === 'object' && frame.snapshot !== null) {
      host.snapshot = frame.snapshot;
      host.connection = 'connected';
      host.attempt = 0;
      if (host.restoring) {
        // First snapshot after a re-park: the service's admitted list is this host's own earlier
        // admissions, so it seeds the hub's content gate exactly once (D-4).
        host.restoring = false;
        for (const p of frame.snapshot.participants) {
          if (p.state === 'admitted') host.hub?.admit(p.githubId);
        }
      }
      host.hub?.onSnapshot(frame.snapshot);
    } else if (frame.type === 'signal' && typeof frame.githubId === 'number' && typeof frame.data === 'object' && frame.data !== null) {
      host.hub?.onSignal(frame.githubId, frame.data);
    } else if (frame.type === 'ice-servers' && Array.isArray(frame.iceServers)) {
      host.hub?.onIceServers(frame.iceServers);
    } else if (frame.type === 'error' && typeof frame.code === 'string') {
      host.lastError = typeof frame.githubId === 'number'
        ? { code: frame.code, githubId: frame.githubId, at: this.deps.now().toISOString() }
        : { code: frame.code, at: this.deps.now().toISOString() };
      if (frame.code === 'turn_unavailable') host.hub?.onIceServersUnavailable();
    }
    // Unknown types are ignored.
  }

  /** Sends one host frame for the hub; false when this host's socket cannot send. */
  private sendHostFrame(host: ShareHost, frame: HostFrame): boolean {
    if (this.hosts.get(host.shortCode) !== host || host.conn.done || host.connection !== 'connected') return false;
    if (host.conn.socket.readyState !== WebSocket.OPEN) return false;
    try {
      host.conn.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  private startKeepalive(host: ShareHost, conn: HostConnection): void {
    this.armPongDeadline(host, conn);
    host.pingTimer = setInterval(() => {
      try {
        conn.socket.ping();
      } catch {
        // The close handler reconnects.
      }
    }, PING_INTERVAL_MS);
    host.pingTimer.unref?.();
  }

  private armPongDeadline(host: ShareHost, conn: HostConnection): void {
    if (host.pongTimer) clearTimeout(host.pongTimer);
    host.pongTimer = setTimeout(() => {
      if (!conn.done && host.conn === conn) this.lose(host, 'terminate');
    }, PONG_TIMEOUT_MS);
    host.pongTimer.unref?.();
  }

  private stopKeepalive(host: ShareHost): void {
    if (host.pingTimer) clearInterval(host.pingTimer);
    if (host.pongTimer) clearTimeout(host.pongTimer);
    host.pingTimer = null;
    host.pongTimer = null;
  }

  /** Abandons the current socket, keeps the entry, its hub and the record, and retries on the backoff (D-1, D-2). */
  private lose(host: ShareHost, how: 'terminate' | 'none'): void {
    host.conn.done = true;
    this.stopKeepalive(host);
    if (how === 'terminate') this.shut(host.conn.socket, 'terminate');
    host.connection = 'reconnecting';
    this.scheduleRetry(host);
  }

  private scheduleRetry(host: ShareHost): void {
    const delays = this.deps.reconnectDelaysMs ?? SHARE_RECONNECT_DELAYS_MS;
    const delay = delays[Math.min(host.attempt, delays.length - 1)] ?? 0;
    host.attempt += 1;
    host.retryTimer = setTimeout(() => {
      host.retryTimer = null;
      if (this.hosts.get(host.shortCode) !== host || host.connection !== 'reconnecting') return;
      try {
        this.connect(host);
      } catch {
        // openSocket threw synchronously: wait for the next slot.
        this.scheduleRetry(host);
      }
    }, delay);
    host.retryTimer.unref?.();
  }

  /** Forgets the host entry for `shortCode` and shuts its socket. */
  private dropHost(shortCode: string, how: 'close' | 'terminate' | 'none'): void {
    const host = this.hosts.get(shortCode);
    if (!host) return;
    this.hosts.delete(shortCode);
    host.connection = 'disconnected';
    host.conn.done = true;
    this.stopKeepalive(host);
    if (host.retryTimer) clearTimeout(host.retryTimer);
    host.retryTimer = null;
    host.hub?.close();
    if (how !== 'none') this.shut(host.conn.socket, how);
  }

  private shut(socket: ShareSocket, how: 'close' | 'terminate'): void {
    try {
      if (how === 'terminate') socket.terminate();
      else if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000);
    } catch {
      // Already closed.
    }
  }

  private removeRecord(shortCode: string): void {
    const removal = this.deps.records.remove(shortCode).catch(() => false);
    this.removals.add(removal);
    void removal.finally(() => this.removals.delete(removal));
  }
}

export function defaultOpenSocket(url: string, headers: Record<string, string>): ShareSocket {
  return new WebSocket(url, { headers, handshakeTimeout: 10_000 });
}

function productionDeps(): ShareManagerDeps {
  return {
    readAccount,
    readShareUrl,
    createRoom,
    deleteRoom,
    records: { read: readShareRecords, put: putShareRecord, remove: removeShareRecord },
    openSocket: defaultOpenSocket,
    now: () => new Date(),
    createHub: (ctx) => new PeerHub(ctx, productionPeerHubDeps(ctx.scope.conversationId)),
  };
}

let manager: ShareManager | null = null;

/** The process-wide manager, created on first use with production deps. */
export function getShareManager(): ShareManager {
  manager ??= new ShareManager(productionDeps());
  return manager;
}

export function setShareManagerForTests(next: ShareManager | null): void {
  manager = next;
}
