/**
 * Durable Object glue for one account's directory (PRD PAN-2356 WI-5).
 *
 * `DirectoryHost` owns the hibernating WebSockets and the SQLite tables; every decision is made by
 * the pure reducer in directory-state.ts. Per event: reduce → persist → register → send → close,
 * so a crash never announces a machine that storage lacks.
 *
 * Internal requests arrive only through the Durable Object stub — from routes.ts, or from the
 * account Worker's cross-script binding on the ACCOUNT_PATHS (PAN-4959) — so the identity header is
 * trusted here; the public `Authorization` header is never read.
 * This module uses Web APIs only; src/index.ts owns the `cloudflare:workers` import.
 */
import type { DirectoryToClientFrame, DirectoryToMachineFrame } from '../../../packages/contracts/src/connect.ts';
import { ACCOUNT_PATHS, accountView } from './account-view.ts';
import { reduceClient } from './client-state.ts';
import type { ClientEvent } from './client-state.ts';
import { EMPTY_DIRECTORY, reduce } from './directory-state.ts';
import type { DirectoryEffect, DirectoryEvent, DirectoryState, ReduceContext, Target } from './directory-state.ts';
import { loadDirectory, PUT_CLIENT_PUSH_SQL, PUT_CLIENT_SQL, PUT_PUSH_WINDOW_SQL, SCHEMA } from './directory-store.ts';
import type { ConnectIdentity, Deps, Env } from './env.ts';
import { HDR_IDENTITY, HDR_INBOX_HEADERS, HDR_INBOX_SECRET_HASH, INTERNAL, parseConfig, parseTurnConfig } from './env.ts';
import { keyFingerprint } from './fingerprint.ts';
import { isWebSocketUpgrade, json } from './http.ts';
import { bytesToBase64, InboxStore, NOT_FOUND } from './inbox.ts';
import type { PendingEvent } from './inbox.ts';
import { logFrame } from './log.ts';
import { decodeFrame } from './protocol.ts';
import { reducePushOutcome } from './push-state.ts';
import type { PushOutcomeEvent } from './push-state.ts';
import { parsePushConfig } from './push/config.ts';
import { deliverPush } from './push/deliver.ts';
import type { SocketRole } from './protocol.ts';
import { relayCapBytes } from './relay-meter.ts';
import { fetchIceServers } from './turn.ts';

/**
 * Every socket keeps this tag, phones included (PAN-4829 D-1): tags are fixed at accept time, before
 * the first hello says which role the socket has, and renaming the tag would orphan sockets that
 * hibernated before the client role shipped. The role lives in the attachment instead.
 */
export const MACHINE_TAG = 'machine';

/**
 * Per-socket state that survives hibernation. `environmentId` is set by a valid `hello`, `clientId`
 * by a valid `hello-client` (PAN-4829). Attachments written before PAN-4829 have no `clientId` key.
 */
interface Attachment {
  identity: ConnectIdentity;
  environmentId: string | null;
  clientId?: string | null;
}

/** A socket's role: client once `hello-client` bound it, machine once `hello` did, else none yet. */
export function roleOf(a: Attachment): SocketRole | null {
  if (a.clientId) return 'client';
  return a.environmentId ? 'machine' : null;
}

/** Trusted header from the Worker, still shape-checked so a bug there cannot corrupt the registry. */
function parseIdentity(raw: string | null): ConnectIdentity | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { userId, githubId, deviceId, plan, maxDevices } = value as Record<string, unknown>;
  if (typeof userId !== 'string' || typeof deviceId !== 'string') return null;
  if (typeof githubId !== 'number' || !Number.isSafeInteger(githubId)) return null;
  if (plan !== 'free' && plan !== 'tester') return null;
  if (maxDevices !== null && (typeof maxDevices !== 'number' || !Number.isSafeInteger(maxDevices) || maxDevices < 0)) return null;
  return { userId, githubId, deviceId, plan, maxDevices };
}

function safeSend(ws: WebSocket, frame: DirectoryToMachineFrame | DirectoryToClientFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // The socket is already closing; its close handler reconciles presence.
  }
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}

function attachmentOf(ws: WebSocket): Attachment | null {
  return (ws.deserializeAttachment() as Attachment | null) ?? null;
}

function inboxEventFrame(event: PendingEvent): DirectoryToMachineFrame {
  return { type: 'inbox-event', eventId: event.eventId, inboxId: event.inboxId, receivedAt: event.receivedAt, sealed: bytesToBase64(event.sealed) };
}

function parseHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(value)) if (typeof v === 'string') out[key] = v;
    return out;
  } catch {
    return {};
  }
}

/** The `environmentId` of a `/remove-machine` body: a string of 1-64 characters, else null. */
async function parseEnvironmentId(req: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const { environmentId } = body as Record<string, unknown>;
  return typeof environmentId === 'string' && environmentId.length >= 1 && environmentId.length <= 64 ? environmentId : null;
}

export class DirectoryHost {
  private state: DirectoryState = EMPTY_DIRECTORY;
  private inbox!: InboxStore;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
    private readonly deps: Deps,
  ) {
    // Answered by the runtime without waking the object (NFR-2356-2).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      for (const statement of SCHEMA) ctx.storage.sql.exec(statement);
      this.inbox = new InboxStore(ctx.storage.sql, { ...deps, randomUUID: () => crypto.randomUUID() });
      this.state = loadDirectory(ctx.storage.sql);
    });
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === INTERNAL.inbox && req.method === 'POST') return this.intake(req);
    if (pathname === ACCOUNT_PATHS.view && req.method === 'GET') {
      const online = new Set(this.registered().map((r) => r.environmentId));
      return json(accountView(this.state, online, this.deps.now(), relayCapBytes(this.env.RELAY_CAP_BYTES)));
    }
    if (pathname === ACCOUNT_PATHS.removeMachine && req.method === 'POST') return this.removeMachine(req);
    if (pathname !== INTERNAL.socket || !isWebSocketUpgrade(req)) return new Response(null, { status: 404 });
    const identity = parseIdentity(req.headers.get(HDR_IDENTITY));
    if (!identity) return new Response(null, { status: 400 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [MACHINE_TAG]);
    server.serializeAttachment({ identity, environmentId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentOf(ws);
    if (!attachment) return;
    const registeredAs = attachment.environmentId;
    const clientId = attachment.clientId ?? null;
    const decoded = decodeFrame(message, roleOf(attachment));
    const { deviceId, plan, maxDevices } = attachment.identity;
    if (!decoded.ok) {
      if (clientId !== null) await this.applyClient(ws, { kind: 'client-bad-frame', clientId, reason: decoded.reason });
      else await this.apply(ws, { kind: 'bad-frame', registeredAs, reason: decoded.reason });
      return;
    }
    if (decoded.role === 'client') {
      const frame = decoded.frame;
      if (frame.type === 'hello-client') {
        await this.applyClient(ws, { kind: 'hello-client', registeredAs: clientId, identity: { deviceId, plan, maxDevices }, frame });
      } else if (clientId !== null) {
        // Only a client socket decodes later client frames (D-4), so clientId is set here.
        await this.applyClient(ws, { kind: 'client-frame', clientId, frame });
      }
      return;
    }
    const frame = decoded.frame;
    if (frame.type === 'hello') {
      const fingerprint = await keyFingerprint(frame.publicKeyHex);
      await this.apply(ws, { kind: 'hello', registeredAs, identity: { deviceId, plan, maxDevices }, frame, fingerprint });
      return;
    }
    await this.apply(ws, { kind: 'frame', registeredAs, frame });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Answer the client's close frame so its close completes now, not at the runtime's timeout.
    safeClose(ws, 1000, 'closed');
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  /** D-2356-18 expiry and nack re-sends. Due events for an offline machine wait for its welcome. */
  async alarm(): Promise<void> {
    const now = this.deps.now();
    this.inbox.expire(now);
    const due = this.inbox.dueRetries(now);
    this.sendEvents(due);
    this.inbox.markSent(due.map((e) => e.eventId));
    await this.rearm();
  }

  /** The account page's Remove (PAN-4959 WI-2): `{ environmentId }`, with no calling socket. */
  private async removeMachine(req: Request): Promise<Response> {
    const environmentId = await parseEnvironmentId(req);
    if (environmentId === null) return json({ error: 'bad_request' }, 400);
    if (!this.state.machines.some((m) => m.environmentId === environmentId)) return json({ error: 'unknown_machine' }, 404);
    await this.apply(null, { kind: 'remove-machine', environmentId });
    return json({ removed: true });
  }

  /** A webhook event for one of this account's inboxes (the Worker already capped the body). */
  private async intake(req: Request): Promise<Response> {
    const result = this.inbox.intake({
      secretHash: req.headers.get(HDR_INBOX_SECRET_HASH) ?? '',
      headers: parseHeaders(req.headers.get(HDR_INBOX_HEADERS)),
      body: new Uint8Array(await req.arrayBuffer()),
      plan: this.state.plan,
      publicKeyHexOf: (env) => this.state.machines.find((m) => m.environmentId === env)?.publicKeyHex ?? null,
    });
    if (result.status === 202) {
      const sent = this.sendEvents([result.event]);
      if (sent.length > 0) this.inbox.markSent(sent);
      await this.rearm();
      logFrame('inbox-event', result.event.environmentId, sent.length > 0 ? 'delivered' : 'held');
      return json(result.body, 202);
    }
    logFrame('inbox-event', null, String(result.status));
    if (result.status === 404) return json(NOT_FOUND, 404);
    if (result.status === 429) return json(result.body, 429, { 'Retry-After': String(result.retryAfter) });
    return json(result.body, result.status);
  }

  /** Sends each event to its machine's open sockets; returns the ids that reached a socket. */
  private sendEvents(events: readonly PendingEvent[]): string[] {
    const sockets = this.registered();
    const sent: string[] = [];
    for (const event of events) {
      const targets = sockets.filter((r) => r.environmentId === event.environmentId);
      for (const { ws } of targets) safeSend(ws, inboxEventFrame(event));
      if (targets.length > 0) sent.push(event.eventId);
    }
    return sent;
  }

  private async rearm(): Promise<void> {
    const at = this.inbox.nextAlarm();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /** Open sockets with a role, optionally excluding one. Every socket carries MACHINE_TAG (D-1). */
  private openOf(role: SocketRole, except: WebSocket | null): Array<{ ws: WebSocket; id: string }> {
    const out: Array<{ ws: WebSocket; id: string }> = [];
    for (const ws of this.ctx.getWebSockets(MACHINE_TAG)) {
      if (ws === except || ws.readyState !== WebSocket.OPEN) continue;
      const attachment = attachmentOf(ws);
      if (!attachment || roleOf(attachment) !== role) continue;
      const id = role === 'client' ? attachment.clientId : attachment.environmentId;
      if (id) out.push({ ws, id });
    }
    return out;
  }

  /** Open sockets bound to a machine, optionally excluding one. Phone sockets are never listed (H-2). */
  private registered(except: WebSocket | null = null): Array<{ ws: WebSocket; environmentId: string }> {
    return this.openOf('machine', except).map(({ ws, id }) => ({ ws, environmentId: id }));
  }

  /** Open sockets bound to a phone, optionally excluding one (PAN-4829). */
  private registeredClients(except: WebSocket | null = null): Array<{ ws: WebSocket; clientId: string }> {
    return this.openOf('client', except).map(({ ws, id }) => ({ ws, clientId: id }));
  }

  /**
   * A machine or phone goes offline only when no other open socket is bound to it (a replaced
   * socket must not).
   */
  private async onSocketGone(ws: WebSocket): Promise<void> {
    const attachment = attachmentOf(ws);
    if (!attachment) return;
    const role = roleOf(attachment);
    if (role === 'client') {
      const clientId = attachment.clientId as string;
      if (this.registeredClients(ws).some((r) => r.clientId === clientId)) return;
      await this.applyClient(ws, { kind: 'client-gone', clientId });
      return;
    }
    const environmentId = attachment.environmentId;
    if (role !== 'machine' || !environmentId) return;
    if (this.registered(ws).some((r) => r.environmentId === environmentId)) return;
    await this.apply(ws, { kind: 'socket-gone', registeredAs: environmentId });
  }

  /** The reducer context for an event on `ws`: who else is online, excluding `ws` itself (null ⇒ every socket). */
  private context(ws: WebSocket | null): ReduceContext {
    const config = parseConfig(this.env);
    return {
      now: this.deps.now(),
      online: new Set(this.registered(ws).map((r) => r.environmentId)),
      onlineClients: new Set(this.registeredClients(ws).map((r) => r.clientId)),
      stunUrls: config.ok ? config.config.stunUrls : [],
      relayCapBytes: relayCapBytes(this.env.RELAY_CAP_BYTES),
      turnConfigured: parseTurnConfig(this.env) !== null,
    };
  }

  /** `ws` is null for an event no socket sent (PAN-4959 D-5: the account page's remove-machine). */
  private async apply(ws: WebSocket | null, event: DirectoryEvent): Promise<void> {
    const { state, effects } = reduce(this.state, event, this.context(ws));
    this.state = state;
    await this.execute(ws, effects);
  }

  /** Phone events go to the client reducer (PAN-4829 D-5); effects run through the same executor. */
  private async applyClient(ws: WebSocket, event: ClientEvent): Promise<void> {
    const { state, effects } = reduceClient(this.state, event, this.context(ws));
    this.state = state;
    await this.execute(ws, effects);
  }

  /** The second step of a push (PAN-4830 D-1), reduced against the state current after delivery. */
  private async applyPushOutcome(ws: WebSocket, event: PushOutcomeEvent): Promise<void> {
    const { state, effects } = reducePushOutcome(this.state, event);
    this.state = state;
    await this.execute(ws, effects);
  }

  private resolve(self: WebSocket | null, to: Target): WebSocket[] {
    if (to === 'self') return self ? [self] : [];
    if (to === 'clients') return this.registeredClients(self).map((r) => r.ws);
    if (typeof to === 'object' && 'clientId' in to) {
      return this.registeredClients(self).filter((r) => r.clientId === to.clientId).map((r) => r.ws);
    }
    const others = this.registered(self);
    if (to === 'others') return others.map((r) => r.ws);
    if (to === 'all') return self ? [self, ...others.map((r) => r.ws)] : others.map((r) => r.ws);
    return others.filter((r) => r.environmentId === to.environmentId).map((r) => r.ws);
  }

  /** Persistence, then registration, then sends (and TURN answers), then closes, then logs. */
  private async execute(self: WebSocket | null, effects: DirectoryEffect[]): Promise<void> {
    const order: Record<DirectoryEffect['kind'], number> = {
      'put-plan': 0,
      'put-machine': 0,
      'delete-machine': 0,
      'put-approval': 0,
      'delete-approval': 0,
      'put-relay-usage': 0,
      'inbox-delete': 0,
      'inbox-ack': 0,
      'inbox-nack': 0,
      'inbox-forget': 0,
      'put-client': 0,
      'put-client-push': 0,
      'put-push-window': 0,
      'delete-client': 0,
      register: 1,
      'register-client': 1,
      send: 2,
      'fetch-turn': 2,
      'deliver-push': 2,
      'inbox-create': 2,
      'inbox-deliver': 2,
      close: 3,
      log: 4,
    };
    const sorted = effects.map((e, i) => ({ e, i })).sort((a, b) => order[a.e.kind] - order[b.e.kind] || a.i - b.i);
    const sql = this.ctx.storage.sql;
    // Read lazily: a `register` effect earlier in this run binds the socket to its machine.
    const selfEnv = (): string | null => (self ? (attachmentOf(self)?.environmentId ?? null) : null);
    let inboxChanged = false;
    for (const { e } of sorted) {
      switch (e.kind) {
        case 'put-plan':
          sql.exec(`INSERT INTO meta (key, value) VALUES ('plan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, e.plan);
          break;
        case 'put-machine': {
          const r = e.row;
          sql.exec(
            `INSERT INTO machines (environment_id, label, public_key_hex, fingerprint, endpoints_json, server_version, device_id, registered_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(environment_id) DO UPDATE SET label = excluded.label, public_key_hex = excluded.public_key_hex,
               fingerprint = excluded.fingerprint, endpoints_json = excluded.endpoints_json, server_version = excluded.server_version,
               device_id = excluded.device_id, last_seen_at = excluded.last_seen_at`,
            r.environmentId, r.label, r.publicKeyHex, r.fingerprint, JSON.stringify(r.endpoints), r.serverVersion, r.deviceId,
            r.registeredAt, r.lastSeenAt,
          );
          break;
        }
        case 'delete-machine':
          sql.exec('DELETE FROM machines WHERE environment_id = ?', e.environmentId);
          break;
        case 'put-approval': {
          const r = e.row;
          sql.exec(
            'INSERT INTO approvals (request_id, from_env, to_env, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
            r.requestId, r.fromEnv, r.toEnv, r.createdAt, r.expiresAt,
          );
          break;
        }
        case 'delete-approval':
          sql.exec('DELETE FROM approvals WHERE request_id = ?', e.requestId);
          break;
        case 'put-relay-usage':
          sql.exec(
            'INSERT INTO relay_usage (month, bytes) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET bytes = excluded.bytes',
            e.usage.month, e.usage.bytes,
          );
          break;
        case 'inbox-create': {
          const self$ = selfEnv();
          if (!self || !self$) break;
          const config = parseConfig(this.env);
          if (!config.ok) {
            safeSend(self, { type: 'error', code: 'unsupported', message: 'the inbox is not configured', requestId: e.requestId });
            break;
          }
          const { inboxId, secret } = await this.inbox.create(self$);
          const url = `${config.config.publicBaseUrl}/h/${this.ctx.id.toString()}.${secret}`;
          safeSend(self, { type: 'inbox-created', requestId: e.requestId, inboxId, url });
          break;
        }
        case 'inbox-delete': {
          const self$ = selfEnv();
          if (self$) inboxChanged = this.inbox.delete(e.inboxId, self$) || inboxChanged;
          break;
        }
        case 'inbox-ack': {
          const self$ = selfEnv();
          if (self$) this.inbox.ack(e.eventId, self$);
          inboxChanged = true;
          break;
        }
        case 'inbox-nack': {
          const self$ = selfEnv();
          if (self$) this.inbox.nack(e.eventId, self$, e.retryAfterSeconds);
          inboxChanged = true;
          break;
        }
        case 'inbox-forget':
          this.inbox.deleteForMachine(e.environmentId);
          inboxChanged = true;
          break;
        case 'inbox-deliver': {
          const self$ = selfEnv();
          if (!self || !self$) break;
          const pending = this.inbox.pendingFor(self$);
          for (const event of pending) safeSend(self, inboxEventFrame(event));
          this.inbox.markSent(pending.map((p) => p.eventId));
          break;
        }
        case 'fetch-turn': {
          if (!self) break;
          const result = await fetchIceServers(parseTurnConfig(this.env), this.deps);
          safeSend(
            self,
            result.ok
              ? { type: 'ice-servers', requestId: e.requestId, iceServers: result.iceServers }
              : { type: 'error', code: 'turn_unavailable', message: 'relay credentials are not available', requestId: e.requestId },
          );
          break;
        }
        case 'put-client': {
          const r = e.row;
          sql.exec(PUT_CLIENT_SQL, r.clientId, r.label, r.publicKeyHex, r.platform, r.appVersion, r.deviceId, r.registeredAt, r.lastSeenAt);
          break;
        }
        case 'put-client-push': {
          const r = e.registration;
          sql.exec(PUT_CLIENT_PUSH_SQL, r?.platform ?? null, r?.token ?? null, r?.apsEnvironment ?? null, e.clientId);
          break;
        }
        case 'put-push-window':
          sql.exec(PUT_PUSH_WINDOW_SQL, JSON.stringify(e.window));
          break;
        case 'deliver-push': {
          if (!self) break;
          const outcome = await deliverPush(e, { config: parsePushConfig(this.env), fetch: this.deps.fetch, now: this.deps.now });
          // Other events ran during the await (H-2): read the socket's machine and the state only now.
          await this.applyPushOutcome(self, { requestId: e.requestId, clientId: e.clientId, environmentId: selfEnv(), token: e.registration.token, outcome });
          break;
        }
        case 'delete-client':
          sql.exec('DELETE FROM clients WHERE client_id = ?', e.clientId);
          break;
        case 'register-client': {
          if (!self) break;
          const attachment = attachmentOf(self);
          if (attachment) self.serializeAttachment({ ...attachment, clientId: e.clientId } satisfies Attachment);
          break;
        }
        case 'register': {
          if (!self) break;
          const attachment = attachmentOf(self);
          if (attachment) self.serializeAttachment({ ...attachment, environmentId: e.environmentId } satisfies Attachment);
          break;
        }
        case 'send':
          for (const ws of this.resolve(self, e.to)) safeSend(ws, e.frame);
          break;
        case 'close':
          for (const ws of this.resolve(self, e.to)) safeClose(ws, e.code, e.reason);
          break;
        case 'log':
          logFrame(e.type, e.environmentId, e.outcome, e.clientId);
          break;
      }
    }
    if (inboxChanged) await this.rearm();
  }
}
