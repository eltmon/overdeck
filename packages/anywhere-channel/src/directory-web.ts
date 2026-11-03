/**
 * The phone's overdeck.ai directory socket (PAN-4833 FR-7, D-10; pan-4823 W-WEB1 step 5).
 *
 * The browser counterpart of the machine's `directory-client.ts`, in the client role: it says
 * `hello-client`, carries `signal` and `ice-servers` frames, and keeps the directory's view of the
 * account's machines. A browser cannot set an `Authorization` header on a WebSocket, so the account
 * token rides in the subprotocol `overdeck.bearer.<token>`, and a socket whose accepted protocol
 * differs is closed.
 *
 * Reconnect: back-off 1 s doubling to 300 s with ±20 % jitter, reset on `welcome-client`. A browser
 * never sees the HTTP status of a refused upgrade, so a 401 arrives as close 1006 and is retried;
 * close codes 4001, 4003, 4010, 4011, 4012 and 4013 stop retrying. Keepalive: the text `ping` every
 * 30 s; 75 s without `pong` drops the socket and reconnects.
 *
 * `onStateChange` listeners hear every state change and every machine-list update (`welcome-client`,
 * `directory`), so one subscription keeps a screen current (PAN-4837 WI-4).
 */
import {
  CLIENT_LIMIT_MESSAGE,
  type ClientPlatform,
  type ClientToDirectoryFrame,
  CONNECT_CLOSE_CODES,
  CONNECT_PROTOCOL_VERSION,
  type ConnectPlan,
  type DirectoryMachine,
  type DirectoryToClientFrame,
  type IceServer,
} from '@overdeck/contracts';

export const BACKOFF_INITIAL_MS = 1_000;
export const BACKOFF_MAX_MS = 300_000;
export const BACKOFF_JITTER = 0.2;
export const PING_INTERVAL_MS = 30_000;
export const PONG_TIMEOUT_MS = 75_000;
export const ICE_SERVERS_TIMEOUT_MS = 10_000;
/** Subprotocol prefix that carries the account token. */
export const BEARER_PROTOCOL_PREFIX = 'overdeck.bearer.';

/** `WebSocket.OPEN`, as a literal so an injected WebSocket class need not define the static. */
const SOCKET_OPEN = 1;

export interface DirectoryWebDeps {
  /** Directory base URL, e.g. https://connect.overdeck.ai; the socket URL is wss://<host>/v1/directory (http → ws). */
  baseUrl: string;
  /** The odd_… account token, or null when signed out (then no socket opens). */
  token(): Promise<string | null>;
  clientId: string;
  label: string;
  publicKeyHex: string;
  appVersion: string;
  platform: ClientPlatform;
  /** Default `globalThis.WebSocket`. */
  WebSocket?: typeof WebSocket;
  /** Default `Math.random`. */
  random?: () => number;
}

export type DirectoryWebState = 'off' | 'connecting' | 'online' | 'refused';

type FrameType = DirectoryToClientFrame['type'];
type Handler<T extends FrameType> = (frame: Extract<DirectoryToClientFrame, { type: T }>) => void;

/** Close codes that stop retrying, with the message the app shows. */
const REFUSALS: Record<number, string> = {
  [CONNECT_CLOSE_CODES.unauthorized]: 'overdeck.ai rejected this sign-in; sign in again',
  [CONNECT_CLOSE_CODES.grantExpired]: 'overdeck.ai access for this account has expired',
  [CONNECT_CLOSE_CODES.unsupportedProtocol]: 'The directory does not support this app version',
  [CONNECT_CLOSE_CODES.replaced]: 'Another copy of this app connected to the directory',
  [CONNECT_CLOSE_CODES.forgotten]: 'This phone was removed from the directory',
  [CONNECT_CLOSE_CODES.clientLimit]: CLIENT_LIMIT_MESSAGE,
};

/** `wss://<host>/v1/directory` for a directory base URL (http → ws). */
export function directoryWebSocketUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + '/v1/directory';
}

/**
 * The label sent in `hello-client`: control characters dropped, trimmed, at most 64 characters, and
 * never empty (the first 8 characters of the client id instead), as the machine's `directoryLabel`.
 */
export function clientLabel(label: string, clientId: string): string {
  const isControl = (ch: string) => {
    const code = ch.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  };
  const clean = [...[...label].filter((ch) => !isControl(ch)).join('').trim()].slice(0, 64).join('').trim();
  return clean.length > 0 ? clean : clientId.slice(0, 8);
}

function randomRequestId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class DirectoryWebClient {
  private _state: DirectoryWebState = 'off';
  private _refusal: string | null = null;
  private _machines: DirectoryMachine[] = [];
  private _plan: ConnectPlan | null = null;
  private _relayAllowed = false;
  private socket: WebSocket | null = null;
  private stopped = true;
  private backoffMs = BACKOFF_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private readonly handlers = new Map<FrameType, Set<(frame: DirectoryToClientFrame) => void>>();
  private readonly stateListeners = new Set<(state: DirectoryWebState) => void>();

  constructor(private readonly deps: DirectoryWebDeps) {}

  get state(): DirectoryWebState {
    return this._state;
  }

  get refusal(): string | null {
    return this._refusal;
  }

  get machines(): readonly DirectoryMachine[] {
    return this._machines;
  }

  get plan(): ConnectPlan | null {
    return this._plan;
  }

  get relayAllowed(): boolean {
    return this._relayAllowed;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.backoffMs = BACKOFF_INITIAL_MS;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.dropSocket();
    this.setState('off');
  }

  /** Sends a frame when the socket is online; false otherwise. */
  send(frame: ClientToDirectoryFrame): boolean {
    if (this._state !== 'online' || !this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  /** Subscribe to one frame type; returns the unsubscribe function. */
  on<T extends FrameType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const entry = handler as (frame: DirectoryToClientFrame) => void;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  /**
   * Subscribe to state changes and machine-list updates; returns the unsubscribe function. A
   * machine-list update calls the listener with the unchanged state.
   */
  onStateChange(listener: (state: DirectoryWebState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** Ask the directory for ICE servers; rejects on a matching `error` frame or after 10 s. */
  iceServers(relay: boolean): Promise<readonly IceServer[]> {
    const requestId = randomRequestId();
    return new Promise<readonly IceServer[]>((resolve, reject) => {
      const offs: Array<() => void> = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (finish: () => void): void => {
        if (timer) clearTimeout(timer);
        for (const off of offs.splice(0)) off();
        finish();
      };
      offs.push(
        this.on('ice-servers', (frame) => {
          if (frame.requestId === requestId) settle(() => resolve(frame.iceServers));
        }),
        this.on('error', (frame) => {
          if (frame.requestId === requestId) settle(() => reject(new Error(frame.message)));
        }),
      );
      timer = setTimeout(
        () => settle(() => reject(new Error(`The directory sent no ICE servers within ${ICE_SERVERS_TIMEOUT_MS} ms`))),
        ICE_SERVERS_TIMEOUT_MS,
      );
      if (!this.send({ type: 'ice-servers', requestId, relay })) {
        settle(() => reject(new Error('Not connected to the overdeck.ai directory')));
      }
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let token: string | null;
    try {
      token = await this.deps.token();
    } catch {
      token = null;
    }
    if (this.stopped) return;
    if (token === null) {
      this._refusal = null;
      this._machines = [];
      this._plan = null;
      this._relayAllowed = false;
      this.setState('off');
      return;
    }
    this.setState('connecting');
    const protocol = BEARER_PROTOCOL_PREFIX + token;
    const WebSocketClass = this.deps.WebSocket ?? globalThis.WebSocket;
    let socket: WebSocket;
    try {
      socket = new WebSocketClass(directoryWebSocketUrl(this.deps.baseUrl), [protocol]);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      if (socket.protocol !== protocol) {
        this.dropSocket();
        this.scheduleReconnect();
        return;
      }
      this.sendHello(socket);
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      if (this.socket === socket && typeof event.data === 'string') this.onMessage(event.data);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      const refusal = REFUSALS[event.code];
      if (refusal !== undefined) {
        this.refuse(refusal);
        return;
      }
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      // A 'close' always follows; the reconnect is scheduled there.
    });
  }

  private sendHello(socket: WebSocket): void {
    const hello: ClientToDirectoryFrame = {
      type: 'hello-client',
      protocol: CONNECT_PROTOCOL_VERSION,
      clientId: this.deps.clientId,
      label: clientLabel(this.deps.label, this.deps.clientId),
      publicKeyHex: this.deps.publicKeyHex,
      appVersion: this.deps.appVersion.slice(0, 32),
      platform: this.deps.platform,
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
    let frame: DirectoryToClientFrame;
    try {
      frame = JSON.parse(text) as DirectoryToClientFrame;
    } catch {
      return;
    }
    if (typeof frame !== 'object' || frame === null || typeof frame.type !== 'string') return;
    switch (frame.type) {
      case 'welcome-client':
        this._refusal = null;
        this.backoffMs = BACKOFF_INITIAL_MS;
        this._plan = frame.plan;
        this._relayAllowed = frame.relayAllowed;
        this._machines = [...frame.machines];
        this.setState('online', true);
        break;
      case 'directory':
        this._machines = [...frame.machines];
        this.notifyState();
        break;
      case 'error':
        if (frame.code === 'client_limit') this._refusal = frame.message;
        break;
      default:
        break;
    }
    for (const handler of [...(this.handlers.get(frame.type) ?? [])]) {
      try {
        handler(frame);
      } catch {
        // One feature's handler must not break the socket for the others.
      }
    }
  }

  private refuse(message: string): void {
    this.dropSocket();
    this.clearReconnect();
    this._refusal = message;
    this.setState('refused');
  }

  /** Assigns the state and tells the listeners when it changed, or always when `notify` is set. */
  private setState(next: DirectoryWebState, notify = false): void {
    const changed = this._state !== next;
    this._state = next;
    if (changed || notify) this.notifyState();
  }

  private notifyState(): void {
    for (const listener of [...this.stateListeners]) {
      try {
        listener(this._state);
      } catch {
        // A listener's failure must not break the socket.
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.setState('connecting');
    this.clearReconnect();
    const random = this.deps.random ?? Math.random;
    const jitter = 1 + (random() * 2 - 1) * BACKOFF_JITTER;
    const delay = Math.round(this.backoffMs * jitter);
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private startPing(socket: WebSocket): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket !== socket) return;
      if (Date.now() - this.lastPongAt >= PONG_TIMEOUT_MS) {
        // A silent socket: drop it and reconnect.
        this.dropSocket();
        this.scheduleReconnect();
        return;
      }
      try {
        socket.send('ping');
      } catch {
        // The close handler reconnects.
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.stopPing();
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }
}
