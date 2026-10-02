/**
 * Durable Object glue for one share room (PRD PAN-658 "Durable Object glue").
 *
 * `RoomHost` owns the WebSockets (hibernation API), storage and alarm; every decision is made by
 * the pure reducer in room-state.ts. The flow for each event is: reduce → persist the new record
 * (when it changed) → execute the effects, so a crash never sends a status that storage lacks.
 *
 * Internal requests arrive only from routes.ts through the Durable Object stub, so the headers in
 * env.ts are trusted here; the public `Authorization` header is never read.
 * This module uses Web APIs only; src/index.ts owns the `cloudflare:workers` import.
 */
import type { IceServer, ServiceToHostFrame, ServiceToViewerFrame, ShareIdentity } from '../../../packages/contracts/src/sharing.ts';
import { timingSafeEqualHex } from './codes.ts';
import type { Deps, Env, RoomInitBody, RoomStatusBody } from './env.ts';
import { HDR_HOST_TOKEN_HASH, HDR_IDENTITY, INTERNAL, parseTurnConfig } from './env.ts';
import { decodeHostFrame, decodeViewerFrame } from './protocol.ts';
import { fetchIceServers } from './turn.ts';
import {
  createRoom,
  HOST_RECONNECT_WINDOW_MS,
  reduce,
  toSnapshot,
  type RoomEffect,
  type RoomEvent,
  type RoomRecord,
} from './room-state.ts';

const STORAGE_KEY = 'room';
const HOST_TAG = 'host';
const VIEWER_TAG = 'viewer';

function viewerTag(githubId: number): string {
  return `v:${githubId}`;
}

type Attachment = { role: 'host' } | { role: 'viewer'; identity: ShareIdentity };

function notFound(): Response {
  return new Response(null, { status: 404 });
}

/** Trusted header from the Worker, still shape-checked so a bug there cannot corrupt room state. */
function parseIdentity(raw: string | null): ShareIdentity | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { githubId, login, avatarUrl } = value as Record<string, unknown>;
  if (typeof githubId !== 'number' || !Number.isSafeInteger(githubId) || githubId <= 0) return null;
  if (typeof login !== 'string' || login === '' || typeof avatarUrl !== 'string') return null;
  return { githubId, login, avatarUrl };
}

function safeSend(ws: WebSocket, frame: ServiceToHostFrame | ServiceToViewerFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // The socket is already closing; its close handler reconciles room state.
  }
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}

export class RoomHost {
  private record: RoomRecord | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
    private readonly deps: Deps,
  ) {
    void ctx.blockConcurrencyWhile(async () => {
      this.record = (await ctx.storage.get<RoomRecord>(STORAGE_KEY)) ?? null;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    switch (pathname) {
      case INTERNAL.init:
        return this.init(req);
      case INTERNAL.delete:
        return this.delete(req);
      case INTERNAL.status:
        return this.status();
      case INTERNAL.host:
        return this.acceptHost(req);
      case INTERNAL.join:
        return this.acceptViewer(req);
      default:
        return notFound();
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    if (attachment.role === 'host') {
      const decoded = decodeHostFrame(message);
      if (!decoded.ok) return safeSend(ws, { type: 'error', code: decoded.code });
      await this.apply({ kind: 'host-frame', frame: decoded.frame });
      return;
    }
    const decoded = decodeViewerFrame(message);
    if (!decoded.ok) return safeSend(ws, { type: 'error', code: decoded.code });
    await this.apply({ kind: 'viewer-frame', githubId: attachment.identity.githubId, frame: decoded.frame });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  async alarm(): Promise<void> {
    await this.apply({ kind: 'alarm' });
  }

  private async init(req: Request): Promise<Response> {
    if (req.method !== 'POST') return notFound();
    if (this.record) return new Response(null, { status: 409 });
    const body = (await req.json()) as RoomInitBody;
    const record = createRoom(
      { shortCode: body.shortCode, scope: body.scope, dataOwner: body.dataOwner, hostTokenHash: body.hostTokenHash },
      body.createdAt,
    );
    await this.ctx.storage.put(STORAGE_KEY, record);
    this.record = record;
    // A host that creates a room and never connects must not leave it alive forever.
    await this.ctx.storage.setAlarm(body.createdAt + HOST_RECONNECT_WINDOW_MS);
    return Response.json(toSnapshot(record), { status: 201 });
  }

  /** The active record when the presented host-token hash matches it; null otherwise. */
  private authorizedHost(req: Request): RoomRecord | null {
    const room = this.record;
    if (!room || room.status !== 'active') return null;
    const hash = req.headers.get(HDR_HOST_TOKEN_HASH) ?? '';
    return timingSafeEqualHex(hash, room.hostTokenHash) ? room : null;
  }

  private async delete(req: Request): Promise<Response> {
    if (req.method !== 'POST' || !this.authorizedHost(req)) return notFound();
    await this.apply({ kind: 'delete' });
    return new Response(null, { status: 204 });
  }

  private status(): Response {
    if (!this.record) return notFound();
    const body: RoomStatusBody = { status: this.record.status };
    return Response.json(body);
  }

  private async acceptHost(req: Request): Promise<Response> {
    if (!this.authorizedHost(req)) return notFound();
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    for (const old of this.ctx.getWebSockets(HOST_TAG)) safeClose(old, 4008, 'replaced');
    this.ctx.acceptWebSocket(server, [HOST_TAG]);
    server.serializeAttachment({ role: 'host' } satisfies Attachment);
    await this.apply({ kind: 'host-connected' });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async acceptViewer(req: Request): Promise<Response> {
    const room = this.record;
    if (!room || room.status !== 'active') return notFound();
    const identity = parseIdentity(req.headers.get(HDR_IDENTITY));
    if (!identity) return new Response(null, { status: 400 });
    const tag = viewerTag(identity.githubId);
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    for (const old of this.ctx.getWebSockets(tag)) safeClose(old, 4008, 'replaced');
    this.ctx.acceptWebSocket(server, [VIEWER_TAG, tag]);
    server.serializeAttachment({ role: 'viewer', identity } satisfies Attachment);
    // Refusals (blocked, is-host, full) arrive after the upgrade as close codes, so the client sees a reason.
    await this.apply({ kind: 'viewer-connected', identity });
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A closed or failed socket marks its role offline only when no other open socket holds that role
   * and id: a socket already replaced (4008) must not mark the newer connection offline.
   */
  private async onSocketGone(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    const tag = attachment.role === 'host' ? HOST_TAG : viewerTag(attachment.identity.githubId);
    const stillOpen = this.ctx.getWebSockets(tag).some((other) => other !== ws && other.readyState === WebSocket.OPEN);
    if (stillOpen) return;
    await this.apply(
      attachment.role === 'host' ? { kind: 'host-disconnected' } : { kind: 'viewer-disconnected', githubId: attachment.identity.githubId },
    );
  }

  private async apply(event: RoomEvent): Promise<void> {
    const current = this.record;
    if (!current) return;
    const { room, effects } = reduce(current, event, this.deps.now());
    if (room !== current) {
      await this.ctx.storage.put(STORAGE_KEY, room);
      this.record = room;
    }
    await this.execute(effects);
  }

  /** Runs effects in order, except that every frame is sent before any socket is closed. */
  private async execute(effects: RoomEffect[]): Promise<void> {
    const sends = effects.filter((e) => e.kind === 'send-host' || e.kind === 'send-viewer');
    const rest = effects.filter((e) => e.kind !== 'send-host' && e.kind !== 'send-viewer');
    for (const effect of [...sends, ...rest]) {
      switch (effect.kind) {
        case 'send-host':
          for (const ws of this.ctx.getWebSockets(HOST_TAG)) safeSend(ws, effect.frame);
          break;
        case 'send-viewer':
          for (const ws of this.ctx.getWebSockets(viewerTag(effect.githubId))) safeSend(ws, effect.frame);
          break;
        case 'close-viewer':
          for (const ws of this.ctx.getWebSockets(viewerTag(effect.githubId))) safeClose(ws, effect.code, effect.reason);
          break;
        case 'close-all':
          for (const ws of this.ctx.getWebSockets()) safeClose(ws, effect.code, effect.reason);
          break;
        case 'set-alarm':
          await this.ctx.storage.setAlarm(effect.at);
          break;
        case 'cancel-alarm':
          await this.ctx.storage.deleteAlarm();
          break;
        case 'delete-storage':
          await this.ctx.storage.deleteAlarm();
          await this.ctx.storage.deleteAll();
          break;
        case 'fetch-ice-servers':
          await this.sendIceServers(effect.target);
          break;
      }
    }
  }

  /** Mints TURN credentials for the host or an admitted viewer; any failure is `turn_unavailable`. */
  private async sendIceServers(target: 'host' | { githubId: number }): Promise<void> {
    const result = await fetchIceServers(parseTurnConfig(this.env), this.deps);
    const frame: { type: 'ice-servers'; iceServers: IceServer[] } | { type: 'error'; code: 'turn_unavailable' } = result.ok
      ? { type: 'ice-servers', iceServers: result.iceServers }
      : { type: 'error', code: 'turn_unavailable' };
    const tag = target === 'host' ? HOST_TAG : viewerTag(target.githubId);
    for (const ws of this.ctx.getWebSockets(tag)) safeSend(ws, frame);
  }
}
