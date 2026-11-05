/**
 * The connector's link to its machine and the `DashboardApi` every tool uses
 * (PAN-4927 W-CONN2, PAN-4950 FR-4, FR-5, D-1 to D-4).
 *
 * D-1: requests go through `linkFetch` with `ConnectorLink` as its `routeSource`, so the
 * connector reuses `LinkAgent`'s pool (4 channels, 4 s idle), `host: 'link.invalid'` and the
 * stale-channel resend. `linkFetch` also sends the `x-overdeck-link-actor` header; the machine
 * reads it only for `machine` credentials, so a `connector` credential ignores it (W-CONN1).
 *
 * D-2: `openLinkSocket` bounds every dial at 2.5 s, which a cold ICE negotiation through TURN
 * may exceed. So the link reports `online` only after a probe (one link-mode channel with a 15 s
 * timeout, then closed) has set up the `RTCPeerConnection`; pooled dials reuse that warm
 * connection. Before every probe after the first, the transport entry is closed so a dead peer
 * connection is never reused.
 *
 * D-3, D-4: direct first; relay only when the directory allows it and the relay is not stopped.
 * A failed round waits min(1 s × 2^n, 60 s) and tries again; a success resets n. A request that
 * fails to open a channel marks the link lost and starts the loop. The directory showing the
 * machine offline pauses probing; showing it online again probes at once.
 */
import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';

import type { ChannelSocket } from '../../anywhere/channel/channel-socket.js';
import { ChannelOpenError, type ChannelOpenErrorCode, openChannel, type OpenChannelOptions, type TransportUrl } from '../../anywhere/channel/open.js';
import type { RtcTransport } from '../../anywhere/channel/rtc-transport.js';
import { linkFetch, type LinkRouteInfo, type LinkRouteSource, LinkUnavailableError } from '../../anywhere/link-client.js';
import type { MachineKeyPair } from '../../anywhere/machine-key.js';
import type { DashboardApi } from '../dashboard-api.js';
import type { ConnectorIdentity, ConnectorPairing } from './home.js';

export const PROBE_TIMEOUT_MS = 15_000;
export const RECONNECT_INITIAL_MS = 1_000;
export const RECONNECT_MAX_MS = 60_000;

export type ConnectorRoute = 'direct' | 'relay' | 'down';

export function noDirectPathMessage(label: string): string {
  return `No direct path to ${label}. Use the relay plan, or the Tailscale route in the README.`;
}

export interface ConnectorLinkInput {
  pairing: ConnectorPairing;
  identity: ConnectorIdentity;
  rtc: { transport: Pick<RtcTransport, 'close'>; relayRefusal(): string | null };
  directory: Pick<DirectoryWebClient, 'state' | 'machines' | 'onStateChange'>;
  openProbe?: (url: TransportUrl, opts: OpenChannelOptions) => Promise<ChannelSocket>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openErrorCode(error: unknown): ChannelOpenErrorCode | null {
  return error instanceof ChannelOpenError ? error.code : null;
}

/** The machine answered and refused this connector's link key. */
function refusedByMachine(code: ChannelOpenErrorCode | null): boolean {
  return code === 'unknown-peer' || code === 'identity-refused';
}

export class ConnectorLink implements LinkRouteSource {
  private url: TransportUrl | null = null;
  private route: ConnectorRoute = 'down';
  private attempt = 0;
  private rounds = 0;
  private probing = false;
  private stopped = false;
  private machineOnline: boolean;
  private error: string | null = null;
  private errorCode: ChannelOpenErrorCode | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly waiters = new Set<(online: boolean) => void>();
  private readonly offDirectory: () => void;
  private readonly openProbe: (url: TransportUrl, opts: OpenChannelOptions) => Promise<ChannelSocket>;

  constructor(private readonly input: ConnectorLinkInput) {
    this.openProbe = input.openProbe ?? openChannel;
    this.machineOnline = this.directoryShowsOnline();
    this.offDirectory = input.directory.onStateChange(() => this.onDirectory());
  }

  get environmentId(): string {
    return this.input.pairing.environmentId;
  }

  get label(): string {
    return this.input.pairing.machineLabel;
  }

  routeFor(environmentId: string): LinkRouteInfo | null {
    if (environmentId !== this.environmentId) return null;
    return {
      state: this.url ? 'online' : 'connecting',
      url: this.url,
      machineKey: this.input.pairing.machineKeyHex,
      token: this.input.pairing.token,
      label: this.label,
    };
  }

  waitOnline(environmentId: string, timeoutMs: number): Promise<boolean> {
    if (environmentId !== this.environmentId || this.stopped) return Promise.resolve(false);
    if (this.url) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const done = (online: boolean): void => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve(online);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      this.waiters.add(done);
    });
  }

  async localKey(): Promise<MachineKeyPair> {
    return {
      publicKey: Buffer.from(this.input.identity.linkPublicKey, 'hex'),
      secretKey: Buffer.from(this.input.identity.linkSecretKey, 'hex'),
    };
  }

  health(): { ok: boolean; machine: string; route: ConnectorRoute } {
    return { ok: this.route !== 'down', machine: this.label, route: this.route };
  }

  lastError(): string | null {
    return this.error;
  }

  /**
   * The ChannelOpenError code of the last failed probe round, or null (PAN-5069 A-7b). A refusal
   * by the machine (`unknown-peer`, `identity-refused`) on either probe wins over a transport
   * failure on the other, so `connect` can tell a removed connector from no route even when the
   * direct path is blocked and only the relay reaches the machine.
   */
  lastErrorCode(): ChannelOpenErrorCode | null {
    return this.errorCode;
  }

  /** One probe round now: direct, then relay when allowed. A failure schedules the next round. */
  async connect(): Promise<void> {
    if (this.stopped || this.probing || !this.machineOnline) return;
    this.clearRetry();
    this.probing = true;
    try {
      if (this.rounds > 0) this.input.rtc.transport.close(this.environmentId);
      this.rounds += 1;
      const direct = `rtc://${this.environmentId}` as const;
      try {
        await this.probe(direct, 'direct');
        return;
      } catch (error) {
        this.error = errorText(error);
        this.errorCode = openErrorCode(error);
      }
      const refusal = this.input.rtc.relayRefusal();
      if (refusal !== null) {
        this.error = noDirectPathMessage(this.label);
      } else {
        try {
          await this.probe(`rtc+turn://${this.environmentId}`, 'relay');
          return;
        } catch (error) {
          this.error = errorText(error);
          if (!refusedByMachine(this.errorCode)) this.errorCode = openErrorCode(error);
        }
      }
      this.fail();
    } finally {
      this.probing = false;
    }
  }

  /** A request could not open a channel: drop the route and reconnect. */
  markLost(): void {
    if (this.stopped || !this.url) return;
    this.url = null;
    this.route = 'down';
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearRetry();
    this.offDirectory();
    this.wake(false);
  }

  private async probe(url: TransportUrl, route: ConnectorRoute): Promise<void> {
    const socket = await this.openProbe(url, {
      mode: 'link',
      localKey: await this.localKey(),
      remoteKeyHex: this.input.pairing.machineKeyHex,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    socket.destroy();
    if (this.stopped) return;
    this.url = url;
    this.route = route;
    this.attempt = 0;
    this.error = null;
    this.errorCode = null;
    this.wake(true);
  }

  private fail(): void {
    this.url = null;
    this.route = 'down';
    this.wake(false);
    if (this.stopped || !this.machineOnline) return;
    const delay = Math.min(RECONNECT_INITIAL_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private onDirectory(): void {
    const online = this.directoryShowsOnline();
    const cameBack = online && !this.machineOnline;
    this.machineOnline = online;
    if (!online) {
      this.clearRetry();
      if (this.url) {
        this.url = null;
        this.route = 'down';
      }
      this.error = `${this.label} is offline in the overdeck.ai directory.`;
      return;
    }
    if (cameBack && !this.url) void this.connect();
  }

  private directoryShowsOnline(): boolean {
    const { directory } = this.input;
    return directory.state === 'online' && directory.machines.some((machine) => machine.environmentId === this.environmentId && machine.online);
  }

  private wake(online: boolean): void {
    for (const waiter of [...this.waiters]) waiter(online);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

/** Every tool's API: one JSON request over the connector's link channel pool. */
export function createConnectorDashboardApi(link: ConnectorLink, deps: { linkFetch?: typeof linkFetch } = {}): DashboardApi {
  const fetchOverLink = deps.linkFetch ?? linkFetch;
  return {
    async request(method, path, body, init) {
      let answer: { status: number; json: unknown };
      try {
        answer = await fetchOverLink(link.environmentId, path, {
          method,
          ...(method === 'GET' || method === 'DELETE' ? {} : { body: body ?? {} }),
          ...(init?.signal ? { signal: init.signal } : {}),
          routeSource: link,
        });
      } catch (error) {
        if (init?.signal?.aborted) throw error;
        if (error instanceof ChannelOpenError || error instanceof LinkUnavailableError) {
          link.markLost();
          throw new Error(`${link.label} is unreachable: ${link.lastError() ?? error.message}`);
        }
        throw error;
      }
      // linkFetch turns a non-JSON body into { error: 'invalid-json', text }; tools expect null, as from createFetchDashboardApi.
      const json = answer.json;
      const invalid = typeof json === 'object' && json !== null && 'text' in json && (json as { error?: unknown }).error === 'invalid-json';
      return { status: answer.status, json: invalid ? null : json };
    },
  };
}
