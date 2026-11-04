/**
 * The machine's socket to its account's overdeck.ai directory (PRD PAN-2356 WI-9, FR-20, FR-2356-1/2).
 *
 * One hibernating WebSocket to `<anywhere.directory_url>/v1/directory`, authorised by the device
 * token in `${OVERDECK_HOME}/account.json`. A signed-out machine opens no socket (NFR-8). The client
 * sends `hello`, keeps the directory's view of the account's machines, answers nothing itself, and
 * lets feature modules (direct routes, approvals, relay, inbox) subscribe with `on()` and talk with
 * `send()` without editing this file.
 *
 * Reconnect: back-off 1 s doubling to 300 s with ±20 % jitter, reset on `welcome`. Refusals
 * (401/403 at the upgrade, closes 4001/4003/4009/4010/4011/4012) stop retrying until account.json
 * changes, checked every 60 s or at once through `recheckAccount()`. Keepalive: the text `ping` every 30 s; 75 s without `pong` drops the
 * socket and reconnects.
 *
 * Diagnostics (PAN-5018 FR-7): each transition is always logged (online, socket closed with its code,
 * refusal, upgrade refused, pong timeout, account change). With OVERDECK_ANYWHERE_DEBUG=1 each `signal`
 * frame and each message on a socket that is no longer current are logged too.
 */
import {
  CONNECT_CLOSE_CODES,
  CONNECT_PROTOCOL_VERSION,
  FREE_MACHINE_LIMIT_MESSAGE,
  LINK_PROTOCOL_VERSION,
  type AdvertisedEndpoint,
  type ConnectPlan,
  type DirectoryApprovalView,
  type DirectoryClientState,
  type DirectoryJoinView,
  type DirectoryMachine,
  type DirectoryResponse,
  type DirectoryToMachineFrame,
  type MachineToDirectoryFrame,
  type RelayStatus,
} from '@overdeck/contracts';
import { type RawData, WebSocket } from 'ws';

import type { AccountRecord } from '../../../lib/account/store.js';
import { anywhereDebug, shortId } from '../../../lib/anywhere/debug-log.js';
import { directorySocketUrl, type DirectoryUrlResult } from '../../../lib/anywhere/directory-config.js';
import type { MachineKeyPair } from '../../../lib/anywhere/machine-key.js';

export const BACKOFF_INITIAL_MS = 1_000;
export const BACKOFF_MAX_MS = 300_000;
export const BACKOFF_JITTER = 0.2;
export const PING_INTERVAL_MS = 30_000;
export const PONG_TIMEOUT_MS = 75_000;
export const ACCOUNT_CHECK_MS = 60_000;

/** The part of a `ws` WebSocket the client uses; tests supply a fake. */
export interface DirectorySocket {
  readonly readyState: number;
  on(event: 'open', listener: () => void): unknown;
  on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): unknown;
  on(event: 'unexpected-response', listener: (req: unknown, res: { statusCode?: number }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface DirectoryClientDeps {
  readAccount(): Promise<AccountRecord | null>;
  readDirectoryUrl(): Promise<DirectoryUrlResult>;
  identity(): Promise<{ environmentId: string; label: string }>;
  machineKey(): Promise<MachineKeyPair>;
  endpoints(): AdvertisedEndpoint[];
  endpointsHash(): string;
  serverVersion: string;
  /** Environment ids this machine holds a link to (for `linked` in the view). */
  linkedEnvironmentIds(): Set<string>;
  openSocket(url: string, headers: Record<string, string>): DirectorySocket;
  random(): number;
  /** Always-on transition lines. Default `console.warn` with an `[anywhere] ` prefix. */
  log?: (message: string) => void;
  /** Lines printed only with OVERDECK_ANYWHERE_DEBUG=1. Default `anywhereDebug`. */
  debug?: (message: string) => void;
}

type Handler<T extends DirectoryToMachineFrame['type']> = (frame: Extract<DirectoryToMachineFrame, { type: T }>) => void;

/** Messages for refusals that stop retrying; 4009 carries the directory's exact text. */
const REFUSALS: Record<number, string> = {
  401: 'overdeck.ai rejected this sign-in; run pan account login',
  403: 'overdeck.ai access for this account has expired',
  [CONNECT_CLOSE_CODES.unauthorized]: 'overdeck.ai rejected this sign-in; run pan account login',
  [CONNECT_CLOSE_CODES.grantExpired]: 'overdeck.ai access for this account has expired',
  [CONNECT_CLOSE_CODES.machineLimit]: FREE_MACHINE_LIMIT_MESSAGE,
  [CONNECT_CLOSE_CODES.unsupportedProtocol]: 'The directory does not support this Overdeck version',
  [CONNECT_CLOSE_CODES.replaced]: 'Another Overdeck process registered this machine with the directory',
  [CONNECT_CLOSE_CODES.forgotten]: 'This machine was removed from the directory',
};

function accountKey(account: AccountRecord | null): string {
  return account ? `${account.baseUrl}\n${account.accessToken}` : '';
}

/**
 * The label sent in `hello`: control characters dropped, trimmed, at most 64 characters, and never
 * empty (the first 8 characters of the environment id instead). The directory refuses any other
 * label as a bad frame, which the client would report as an unsupported version.
 */
export function directoryLabel(label: string, environmentId: string): string {
  const isControl = (ch: string) => {
    const code = ch.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  };
  const clean = [...[...label].filter((ch) => !isControl(ch)).join('').trim()].slice(0, 64).join('').trim();
  return clean.length > 0 ? clean : environmentId.slice(0, 8);
}

export class DirectoryClient {
  private state: DirectoryClientState = 'off';
  private signedIn = false;
  private url: string | null = null;
  private plan: ConnectPlan | null = null;
  private refusal: string | null = null;
  private machines: DirectoryMachine[] = [];
  private relay: RelayStatus | null = null;
  private relayAllowed = false;
  private inboxAllowed = false;

  private socket: DirectorySocket | null = null;
  private stopped = true;
  private backoffMs = BACKOFF_INITIAL_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private accountTimer: NodeJS.Timeout | null = null;
  private lastPongAt = 0;
  private sentEndpointsHash = '';
  private connectedAccount = '';
  private readonly handlers = new Map<string, Set<(frame: DirectoryToMachineFrame) => void>>();
  private approvalViews: () => { approvals: DirectoryApprovalView[]; joins: DirectoryJoinView[] } = () => ({ approvals: [], joins: [] });

  private readonly log: (message: string) => void;
  private readonly debug: (message: string) => void;

  constructor(private readonly deps: DirectoryClientDeps) {
    this.log = deps.log ?? ((message) => console.warn(`[anywhere] ${message}`));
    this.debug = deps.debug ?? ((message) => anywhereDebug(message));
  }

  /** Reads account.json; a signed-out machine opens no socket and only re-checks every 60 s. */
  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.accountTimer = setInterval(() => void this.checkAccount(), ACCOUNT_CHECK_MS);
    this.accountTimer.unref?.();
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.accountTimer) clearInterval(this.accountTimer);
    this.accountTimer = null;
    this.clearTimers();
    this.dropSocket();
    this.state = 'off';
  }

  /** Re-read account.json now instead of on the next 60 s check (PAN-4960: dashboard sign-in). */
  async recheckAccount(): Promise<void> {
    await this.checkAccount();
  }

  status(): DirectoryResponse {
    const linked = this.deps.linkedEnvironmentIds();
    const { approvals, joins } = this.approvalViews();
    return {
      signedIn: this.signedIn,
      state: this.state,
      url: this.url,
      plan: this.plan,
      refusal: this.refusal,
      machines: this.machines.map((m) => ({ ...m, endpoints: [...m.endpoints], linked: linked.has(m.environmentId) })),
      approvals,
      joins,
      relay: this.relay,
    };
  }

  isOnline(): boolean {
    return this.state === 'online';
  }

  /** Whether the account's plan includes the relay, as the last `welcome` said. */
  relayEntitled(): boolean {
    return this.state === 'online' && this.relayAllowed;
  }

  /** The directory's last relay status (from `welcome` or `relay-status`). */
  relayStatus(): RelayStatus | null {
    return this.relay;
  }

  inboxEntitled(): boolean {
    return this.state === 'online' && this.inboxAllowed;
  }

  machine(environmentId: string): DirectoryMachine | null {
    return this.machines.find((m) => m.environmentId === environmentId) ?? null;
  }

  /** The approval service (WI-14) supplies `approvals` and `joins` for the view. */
  setApprovalViews(source: (() => { approvals: DirectoryApprovalView[]; joins: DirectoryJoinView[] }) | null): void {
    this.approvalViews = source ?? (() => ({ approvals: [], joins: [] }));
  }

  /** Subscribe to one frame type; returns the unsubscribe function. */
  on<T extends DirectoryToMachineFrame['type']>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const wrapped = handler as (frame: DirectoryToMachineFrame) => void;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }

  /** Sends a frame when the socket is online; false otherwise. */
  send(frame: MachineToDirectoryFrame): boolean {
    if (this.state !== 'online' || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private async checkAccount(): Promise<void> {
    if (this.stopped) return;
    let account: AccountRecord | null;
    try {
      account = await this.deps.readAccount();
    } catch {
      account = null;
    }
    const key = accountKey(account);
    if (key === this.connectedAccount) return;
    // Signed in, signed out or signed in again: start over with a fresh back-off.
    this.log('directory account changed; reconnecting');
    this.clearTimers();
    this.dropSocket();
    this.backoffMs = BACKOFF_INITIAL_MS;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let account: AccountRecord | null;
    try {
      account = await this.deps.readAccount();
    } catch {
      account = null;
    }
    this.connectedAccount = accountKey(account);
    this.signedIn = account !== null;
    if (!account) {
      this.state = 'off';
      this.refusal = null;
      this.machines = [];
      this.relay = null;
      this.plan = null;
      return;
    }
    const configured = await this.deps.readDirectoryUrl();
    if ('error' in configured) {
      this.url = null;
      this.refuse(configured.error);
      return;
    }
    this.url = configured.url;
    this.state = 'connecting';
    let socket: DirectorySocket;
    try {
      socket = this.deps.openSocket(directorySocketUrl(configured.url), { Authorization: `Bearer ${account.accessToken}` });
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.on('open', () => {
      if (this.socket === socket) void this.sendHello(socket);
    });
    socket.on('message', (data, isBinary) => {
      if (this.socket !== socket) {
        this.debug('directory message on a replaced socket ignored');
        return;
      }
      if (!isBinary) this.onMessage(data.toString());
    });
    socket.on('unexpected-response', (_req, res) => {
      if (this.socket !== socket) return;
      const status = res.statusCode ?? 0;
      this.log(`directory upgrade refused (${status})`);
      this.dropSocket();
      if (status === 401 || status === 403) this.refuse(REFUSALS[status] as string);
      else this.scheduleReconnect();
    });
    socket.on('close', (code) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      this.log(`directory socket closed (${code})`);
      const refusal = code >= 4000 ? REFUSALS[code] : undefined;
      if (refusal !== undefined) {
        this.refuse(refusal);
        return;
      }
      this.scheduleReconnect();
    });
    socket.on('error', () => {
      // A 'close' always follows; the reconnect is scheduled there.
    });
  }

  private async sendHello(socket: DirectorySocket): Promise<void> {
    const [{ environmentId, label }, key] = await Promise.all([this.deps.identity(), this.deps.machineKey()]);
    if (this.socket !== socket) return;
    this.sentEndpointsHash = this.deps.endpointsHash();
    const hello: MachineToDirectoryFrame = {
      type: 'hello',
      protocol: CONNECT_PROTOCOL_VERSION,
      environmentId,
      label: directoryLabel(label, environmentId),
      publicKeyHex: key.publicKey.toString('hex'),
      serverVersion: this.deps.serverVersion,
      linkProtocol: LINK_PROTOCOL_VERSION,
      endpoints: this.deps.endpoints().slice(0, 16),
    };
    socket.send(JSON.stringify(hello));
    this.lastPongAt = Date.now();
    this.startPing(socket);
  }

  private onMessage(text: string): void {
    if (text === 'pong') {
      this.lastPongAt = Date.now();
      return;
    }
    let frame: DirectoryToMachineFrame;
    try {
      frame = JSON.parse(text) as DirectoryToMachineFrame;
    } catch {
      return;
    }
    if (typeof frame !== 'object' || frame === null || typeof frame.type !== 'string') return;
    switch (frame.type) {
      case 'welcome':
        this.state = 'online';
        this.refusal = null;
        this.backoffMs = BACKOFF_INITIAL_MS;
        this.plan = frame.plan;
        this.relayAllowed = frame.relayAllowed;
        this.inboxAllowed = frame.inboxAllowed;
        this.relay = frame.relay;
        this.machines = [...frame.machines];
        this.log(`directory online (plan ${frame.plan}, ${frame.machines.length} machines)`);
        break;
      case 'signal': {
        const kind = frame.data.sdp?.type ?? (frame.data.candidate ? 'candidate' : 'empty');
        this.debug(`directory signal from ${shortId(frame.from)} session ${shortId(frame.session)} (${kind})`);
        break;
      }
      case 'directory':
        this.machines = [...frame.machines];
        break;
      case 'relay-status': {
        const { type: _type, ...relay } = frame;
        this.relay = relay;
        break;
      }
      case 'error':
        if (frame.code === 'machine_limit') this.refusal = frame.message;
        break;
      default:
        break;
    }
    for (const handler of this.handlers.get(frame.type) ?? []) {
      try {
        handler(frame);
      } catch {
        // One feature's handler must not break the socket for the others.
      }
    }
  }

  private refuse(message: string): void {
    this.log(`directory refused: ${message}`);
    this.dropSocket();
    this.clearReconnect();
    this.state = 'refused';
    this.refusal = message;
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.state = 'connecting';
    this.clearReconnect();
    const jitter = 1 + (this.deps.random() * 2 - 1) * BACKOFF_JITTER;
    const delay = Math.round(this.backoffMs * jitter);
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startPing(socket: DirectorySocket): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket !== socket) return;
      if (Date.now() - this.lastPongAt >= PONG_TIMEOUT_MS) {
        // A silent socket: drop it and reconnect.
        this.log(`directory silent for ${Math.round((Date.now() - this.lastPongAt) / 1000)} s; reconnecting`);
        this.dropSocket();
        this.scheduleReconnect();
        return;
      }
      try {
        socket.send('ping');
      } catch {
        // The close handler reconnects.
      }
      const hash = this.deps.endpointsHash();
      if (this.state === 'online' && hash !== this.sentEndpointsHash) {
        this.sentEndpointsHash = hash;
        this.send({ type: 'endpoints', endpoints: this.deps.endpoints().slice(0, 16) });
      }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearTimers(): void {
    this.clearReconnect();
    this.stopPing();
  }

  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.stopPing();
    if (!socket) return;
    try {
      socket.terminate();
    } catch {
      // Already closed.
    }
  }
}

export function defaultOpenSocket(url: string, headers: Record<string, string>): DirectorySocket {
  return new WebSocket(url, { headers, handshakeTimeout: 10_000 });
}

let current: DirectoryClient | null = null;

/** Routes, the status card and feature modules read the running client through this seam. */
export function setDirectoryClient(client: DirectoryClient | null): void {
  current = client;
}

export function currentDirectoryClient(): DirectoryClient | null {
  return current;
}
