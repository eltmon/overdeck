/**
 * Durable Object glue for one account's directory (PRD PAN-2356 WI-5).
 *
 * `DirectoryHost` owns the hibernating WebSockets and the SQLite tables; every decision is made by
 * the pure reducer in directory-state.ts. Per event: reduce → persist → register → send → close,
 * so a crash never announces a machine that storage lacks.
 *
 * Internal requests arrive only from routes.ts through the Durable Object stub, so the identity
 * header is trusted here; the public `Authorization` header is never read.
 * This module uses Web APIs only; src/index.ts owns the `cloudflare:workers` import.
 */
import type { ConnectPlan, DirectoryEndpoint, DirectoryToMachineFrame } from '../../../packages/contracts/src/connect.ts';
import { EMPTY_DIRECTORY, reduce } from './directory-state.ts';
import type { ApprovalRow, DirectoryEffect, DirectoryEvent, DirectoryState, MachineRow, Target } from './directory-state.ts';
import type { ConnectIdentity, Deps, Env } from './env.ts';
import { HDR_IDENTITY, INTERNAL, parseConfig, parseTurnConfig } from './env.ts';
import { keyFingerprint } from './fingerprint.ts';
import { isWebSocketUpgrade } from './http.ts';
import { logFrame } from './log.ts';
import { decodeMachineFrame } from './protocol.ts';
import { relayCapBytes } from './relay-meter.ts';
import type { RelayUsage } from './relay-meter.ts';
import { fetchIceServers } from './turn.ts';

const MACHINE_TAG = 'machine';

/** Per-socket state that survives hibernation. `environmentId` is set by a valid `hello`. */
interface Attachment {
  identity: ConnectIdentity;
  environmentId: string | null;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS machines (
    environment_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    public_key_hex TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    endpoints_json TEXT NOT NULL,
    server_version TEXT NOT NULL,
    device_id TEXT NOT NULL,
    registered_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS approvals (
    request_id TEXT PRIMARY KEY,
    from_env TEXT NOT NULL,
    to_env TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS relay_usage (month TEXT PRIMARY KEY, bytes INTEGER NOT NULL)`,
];

interface ApprovalSqlRow {
  request_id: string;
  from_env: string;
  to_env: string | null;
  created_at: number;
  expires_at: number;
  [key: string]: SqlStorageValue;
}

interface MachineSqlRow {
  environment_id: string;
  label: string;
  public_key_hex: string;
  fingerprint: string;
  endpoints_json: string;
  server_version: string;
  device_id: string;
  registered_at: number;
  last_seen_at: number;
  [key: string]: SqlStorageValue;
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

function safeSend(ws: WebSocket, frame: DirectoryToMachineFrame): void {
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

export class DirectoryHost {
  private state: DirectoryState = EMPTY_DIRECTORY;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
    private readonly deps: Deps,
  ) {
    // Answered by the runtime without waking the object (NFR-2356-2).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      for (const statement of SCHEMA) ctx.storage.sql.exec(statement);
      this.state = this.load();
    });
  }

  private load(): DirectoryState {
    const sql = this.ctx.storage.sql;
    const machines = sql
      .exec<MachineSqlRow>('SELECT * FROM machines ORDER BY registered_at, environment_id')
      .toArray()
      .map((r): MachineRow => ({
        environmentId: r.environment_id,
        label: r.label,
        publicKeyHex: r.public_key_hex,
        fingerprint: r.fingerprint,
        endpoints: JSON.parse(r.endpoints_json) as DirectoryEndpoint[],
        serverVersion: r.server_version,
        deviceId: r.device_id,
        registeredAt: r.registered_at,
        lastSeenAt: r.last_seen_at,
      }));
    const planRow = sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'plan'`).toArray()[0];
    const plan = planRow?.value === 'free' || planRow?.value === 'tester' ? (planRow.value as ConnectPlan) : null;
    const approvals = sql
      .exec<ApprovalSqlRow>('SELECT * FROM approvals ORDER BY created_at, request_id')
      .toArray()
      .map((r): ApprovalRow => ({
        requestId: r.request_id,
        fromEnv: r.from_env,
        toEnv: r.to_env,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));
    const relayRow = sql.exec<{ month: string; bytes: number }>('SELECT month, bytes FROM relay_usage ORDER BY month DESC LIMIT 1').toArray()[0];
    const relay: RelayUsage | null = relayRow ? { month: relayRow.month, bytes: relayRow.bytes } : null;
    return { plan, machines, approvals, relay };
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
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
    const decoded = decodeMachineFrame(message);
    if (!decoded.ok) {
      await this.apply(ws, { kind: 'bad-frame', registeredAs, reason: decoded.reason });
      return;
    }
    const frame = decoded.frame;
    if (frame.type === 'hello') {
      const { deviceId, plan, maxDevices } = attachment.identity;
      const fingerprint = await keyFingerprint(frame.publicKeyHex);
      await this.apply(ws, { kind: 'hello', registeredAs, identity: { deviceId, plan, maxDevices }, frame, fingerprint });
      return;
    }
    await this.apply(ws, { kind: 'frame', registeredAs, frame });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  async alarm(): Promise<void> {
    // Filled by the inbox (WI-8).
  }

  /** Open sockets bound to a machine, optionally excluding one. */
  private registered(except: WebSocket | null = null): Array<{ ws: WebSocket; environmentId: string }> {
    const out: Array<{ ws: WebSocket; environmentId: string }> = [];
    for (const ws of this.ctx.getWebSockets(MACHINE_TAG)) {
      if (ws === except || ws.readyState !== WebSocket.OPEN) continue;
      const environmentId = attachmentOf(ws)?.environmentId;
      if (environmentId) out.push({ ws, environmentId });
    }
    return out;
  }

  /** A machine goes offline only when no other open socket is bound to it (a replaced socket must not). */
  private async onSocketGone(ws: WebSocket): Promise<void> {
    const environmentId = attachmentOf(ws)?.environmentId;
    if (!environmentId) return;
    if (this.registered(ws).some((r) => r.environmentId === environmentId)) return;
    await this.apply(ws, { kind: 'socket-gone', registeredAs: environmentId });
  }

  private async apply(ws: WebSocket, event: DirectoryEvent): Promise<void> {
    const online = new Set(this.registered(ws).map((r) => r.environmentId));
    const config = parseConfig(this.env);
    const stunUrls = config.ok ? config.config.stunUrls : [];
    const { state, effects } = reduce(this.state, event, {
      now: this.deps.now(),
      online,
      stunUrls,
      relayCapBytes: relayCapBytes(this.env.RELAY_CAP_BYTES),
      turnConfigured: parseTurnConfig(this.env) !== null,
    });
    this.state = state;
    await this.execute(ws, effects);
  }

  private resolve(self: WebSocket, to: Target): WebSocket[] {
    if (to === 'self') return [self];
    const others = this.registered(self);
    if (to === 'others') return others.map((r) => r.ws);
    if (to === 'all') return [self, ...others.map((r) => r.ws)];
    return others.filter((r) => r.environmentId === to.environmentId).map((r) => r.ws);
  }

  /** Persistence, then registration, then sends (and TURN answers), then closes, then logs. */
  private async execute(self: WebSocket, effects: DirectoryEffect[]): Promise<void> {
    const order: Record<DirectoryEffect['kind'], number> = {
      'put-plan': 0,
      'put-machine': 0,
      'delete-machine': 0,
      'put-approval': 0,
      'delete-approval': 0,
      'put-relay-usage': 0,
      register: 1,
      send: 2,
      'fetch-turn': 2,
      close: 3,
      log: 4,
    };
    const sorted = effects.map((e, i) => ({ e, i })).sort((a, b) => order[a.e.kind] - order[b.e.kind] || a.i - b.i);
    const sql = this.ctx.storage.sql;
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
        case 'fetch-turn': {
          const result = await fetchIceServers(parseTurnConfig(this.env), this.deps);
          safeSend(
            self,
            result.ok
              ? { type: 'ice-servers', requestId: e.requestId, iceServers: result.iceServers }
              : { type: 'error', code: 'turn_unavailable', message: 'relay credentials are not available', requestId: e.requestId },
          );
          break;
        }
        case 'register': {
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
          logFrame(e.type, e.environmentId, e.outcome);
          break;
      }
    }
  }
}
