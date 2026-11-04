/**
 * Link supervisor (PAN-4645 WI-18, FR-3, FR-9, D-4645-6/7/8).
 *
 * One instance on the primary dashboard keeps one secure channel open per
 * machine link on the best route that answers, consumes the peer's heartbeat
 * stream, and owns the link's live state:
 *
 *  - `connecting`: probing every route in parallel (2.5 s each); first success
 *    in rank order wins, the others are closed.
 *  - `online`: the heartbeat arrives every 15 s. Late at 17.5 s ⇒ `connecting`
 *    with fresh probes while the old channel stays open; nothing by 20 s ⇒
 *    `offline` and the old channel is closed.
 *  - `offline`: retried with back-off 1 s doubling to 45 s, ±20 % jitter;
 *    a route that answers with the wrong key backs off to 300 s.
 *  - `unsupported`: the peer lacks `capabilities.machineLinks` or speaks another
 *    link protocol; re-checked only on `reconnect()` or a restart.
 *  - `revoked`: refusal 01 or a heartbeat 401; the link is marked and never
 *    probed again.
 *
 * A heartbeat after a gap carries the peer's last event-loop stall; a stall of
 * at least 2000 ms that ended inside the gap means the peer froze, not the
 * network (`diagnoseGap`, FR-9). Every 60 s a link not on its best route probes
 * the better ones and switches on success. Every dependency is injectable and
 * the loop runs on timers only, so tests drive it with fake timers.
 *
 * PAN-2356 (D-2356-7, D-2356-8): the overdeck.ai directory adds dynamic routes (`direct`,
 * `relay`, and the addresses it reports), merged with the stored ones and never persisted.
 * Probing runs in phases: every stored-kind route at 2.5 s; then `direct` at 10 s only when
 * phase 1 found no channel and no `unknown-peer`; then `relay` at 10 s. When phases 1 and 2 fail
 * and the plan has no relay, the detail is NO_DIRECT_PATH_MESSAGE.
 */
import { Schema } from 'effect';
import {
  EnvironmentDescriptor,
  LINK_PROTOCOL_VERSION,
  type LinkIncident,
  type LinkRouteStatus,
  type LinkState,
  type MachineLinkView,
  NO_DIRECT_PATH_MESSAGE,
  overdeckInstallCommand,
} from '@overdeck/contracts';

import type { ChannelSocket } from '../../../lib/anywhere/channel/channel-socket.js';
import { ChannelOpenError, openChannel, type TransportUrl } from '../../../lib/anywhere/channel/open.js';
import type { LinkRouteInfo, LinkRouteSource } from '../../../lib/anywhere/link-client.js';
import { linksSnapshot, type MachineLink, markLinkRevoked, setLinkRoutes } from '../../../lib/anywhere/link-store.js';
import { lanHostUnreachableRoutes, localNetworkBlockedDetail } from '../../../lib/anywhere/local-network.js';
import { checkLocalNetworkAccess, type LocalNetworkAccess } from '../../../lib/anywhere/local-network-probe.js';
import { ensureMachineKey, type MachineKeyPair } from '../../../lib/anywhere/machine-key.js';
import { type PeerMachineFacts, peerMachineFacts, UNKNOWN_PEER_MACHINE_FACTS } from '../../../lib/anywhere/machine-capabilities.js';
import { type LinkRoute, mergeAdvertised, rankRoutes } from '../../../lib/anywhere/routes.js';
import { channelRequest, type LinkStatusSource, type UnsupportedInstall } from './machine-link-service.js';
import { type HeartbeatHandle, type HeartbeatHandlers, type HeartbeatPayload, openHeartbeatOverChannel } from './link-heartbeat.js';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_LATE_MS = 17_500;
export const HEARTBEAT_DEAD_MS = 20_000;
export const PROBE_TIMEOUT_MS = 2_500;
/** A WebRTC path needs signalling and ICE checks first (D-2356-8). */
export const DIRECT_PROBE_TIMEOUT_MS = 10_000;
export const RELAY_PROBE_TIMEOUT_MS = 10_000;
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_CAP_MS = 45_000;
export const IDENTITY_BACKOFF_CAP_MS = 300_000;
export const BACKOFF_JITTER = 0.2;
export const BETTER_ROUTE_INTERVAL_MS = 60_000;
export const FROZE_MIN_STALL_MS = 2_000;

export interface LinkSupervisorDeps {
  linksSnapshot: () => MachineLink[];
  localKey: () => Promise<MachineKeyPair>;
  openChannel: (url: TransportUrl, opts: Parameters<typeof openChannel>[1]) => Promise<ChannelSocket>;
  channelRequest: typeof channelRequest;
  openHeartbeat: (channel: ChannelSocket, token: string, handlers: HeartbeatHandlers) => Promise<HeartbeatHandle>;
  markLinkRevoked: (id: string) => Promise<unknown>;
  setLinkRoutes: (id: string, routes: LinkRoute[]) => Promise<unknown>;
  /** Called with every descriptor read through a link (WI-19 merges advertised endpoints). */
  onDescriptor?: (link: MachineLink, descriptor: EnvironmentDescriptor) => void | Promise<void>;
  /** Called after each heartbeat on the current channel (PAN-4650: conversations hash). */
  onHeartbeat?: (link: MachineLink, payload: HeartbeatPayload) => void | Promise<void>;
  /** This machine's Overdeck version, for the "install …" detail. */
  serverVersion: string;
  /** PAN-2356: routes the directory offers for this link right now; never persisted. */
  dynamicRoutes?: (link: MachineLink) => LinkRoute[];
  /** PAN-2356: whether the account's plan includes the relay. */
  relayEntitled?: () => boolean;
  /** PAN-4897 D-2/D-3: confirms a LAN `EHOSTUNREACH` against this process's own macOS Local Network access; injected only on darwin. */
  localNetworkAccess?: () => Promise<LocalNetworkAccess>;
  /** PAN-4897 D-6: the path named in the Local Network message. */
  nodePath?: string;
  now: () => number;
  random: () => number;
  log: (message: string) => void;
}

export const defaultLinkSupervisorDeps = (serverVersion: string): LinkSupervisorDeps => ({
  linksSnapshot,
  localKey: ensureMachineKey,
  openChannel,
  channelRequest,
  openHeartbeat: openHeartbeatOverChannel,
  markLinkRevoked,
  setLinkRoutes,
  serverVersion,
  localNetworkAccess: process.platform === 'darwin' ? () => checkLocalNetworkAccess() : undefined,
  nodePath: process.execPath,
  now: () => Date.now(),
  random: () => Math.random(),
  log: (message) => console.warn(`[anywhere] ${message}`),
});

/**
 * Diagnose a heartbeat gap (D-4645-7, D-4645-8). No incident unless the gap
 * crossed the late threshold. `froze` when the peer reports a stall of at least
 * 2000 ms that ended inside the gap (times are relative, so clocks need not
 * agree); otherwise `network`.
 */
export function diagnoseGap(
  gapMs: number,
  lastStall: { durationMs: number; endedAgoMs: number } | null,
  receivedAt: number,
): LinkIncident | null {
  if (gapMs <= HEARTBEAT_LATE_MS) return null;
  const gapStart = receivedAt - gapMs;
  if (lastStall && lastStall.durationMs >= FROZE_MIN_STALL_MS) {
    const stallEnd = receivedAt - lastStall.endedAgoMs;
    if (stallEnd >= gapStart && stallEnd <= receivedAt) {
      return { kind: 'froze', durationMs: lastStall.durationMs, at: new Date(receivedAt).toISOString() };
    }
  }
  return { kind: 'network', durationMs: Math.max(0, gapMs - HEARTBEAT_INTERVAL_MS), at: new Date(receivedAt).toISOString() };
}

export type { UnsupportedInstall };

/**
 * Which Overdeck to install where when link protocols differ (FR-1): the peer's
 * version on this machine when the peer speaks a newer link protocol, this
 * machine's version on the peer otherwise.
 */
export function unsupportedInstall(peerLinkProtocol: number | undefined, peerVersion: string | undefined, localVersion: string): UnsupportedInstall {
  return (peerLinkProtocol ?? 0) > LINK_PROTOCOL_VERSION && peerVersion
    ? { version: peerVersion, on: 'this-machine' }
    : { version: localVersion, on: 'peer' };
}

export function unsupportedDetail(install: UnsupportedInstall, peerLabel: string): string {
  return `Install Overdeck ${install.version} on ${install.on === 'this-machine' ? 'this machine' : peerLabel}: ${overdeckInstallCommand(install.version)}`;
}

type ProbeOutcome =
  | { ok: true; channel: ChannelSocket; route: LinkRoute }
  | { ok: false; failure: 'unsupported'; install: UnsupportedInstall }
  | {
    ok: false;
    failure: 'unreachable' | 'identity-refused' | 'unknown-peer';
    detail: string;
    /** `unreachable` only (PAN-4897 D-2): the LAN tcp:// routes that all failed with `EHOSTUNREACH`. */
    lanBlocked?: string[];
  };

/** A later phase's failure, prefixed with an earlier phase's detail when both carry one. */
function joinFailures(earlier: ProbeOutcome | null, later: ProbeOutcome): ProbeOutcome {
  if (!earlier || earlier.ok || earlier.failure === 'unsupported' || later.ok || later.failure === 'unsupported') return later;
  return { ...later, detail: `${earlier.detail}; ${later.detail}`, lanBlocked: later.lanBlocked ?? earlier.lanBlocked };
}

interface Entry {
  link: MachineLink;
  state: LinkState;
  stateDetail: string | null;
  unsupported: UnsupportedInstall | null;
  currentRoute: string | null;
  channel: ChannelSocket | null;
  heartbeat: HeartbeatHandle | null;
  lastHeartbeatAt: number | null;
  lastEndpointsHash: string | null;
  incident: LinkIncident | null;
  peerVersion: string | null;
  /** PAN-4651 D-4651-8: load, tags and placement from the last heartbeat. */
  machine: PeerMachineFacts;
  attempt: number;
  backoffKind: 'network' | 'identity';
  retryTimer: NodeJS.Timeout | null;
  lateTimer: NodeJS.Timeout | null;
  deadTimer: NodeJS.Timeout | null;
  betterTimer: NodeJS.Timeout | null;
  probing: AbortController | null;
  routeStatus: Map<string, LinkRouteStatus>;
  onlineWaiters: Set<(online: boolean) => void>;
  generation: number;
}

const decodeDescriptor = Schema.decodeUnknownOption(EnvironmentDescriptor);

/** Phase-1 routes take 2.5 s; a WebRTC route needs signalling and ICE, so it gets 10 s. */
function probeTimeoutFor(route: LinkRoute): number {
  if (route.kind === 'direct') return DIRECT_PROBE_TIMEOUT_MS;
  if (route.kind === 'relay') return RELAY_PROBE_TIMEOUT_MS;
  return PROBE_TIMEOUT_MS;
}

const isWebRtc = (route: LinkRoute): boolean => route.kind === 'direct' || route.kind === 'relay';

export class LinkSupervisor implements LinkStatusSource, LinkRouteSource {
  private readonly entries = new Map<string, Entry>();
  private stopped = false;

  constructor(private readonly deps: LinkSupervisorDeps) {}

  /** Connect every non-revoked link from the store snapshot. */
  start(): void {
    this.stopped = false;
    this.reconcile();
  }

  /** Diff the store against the live map: connect new links, tear down removed or revoked ones, adopt route changes. */
  reconcile(): void {
    if (this.stopped) return;
    const seen = new Set<string>();
    for (const link of this.deps.linksSnapshot()) {
      seen.add(link.id);
      const entry = this.entries.get(link.id);
      if (!entry) {
        if (link.revokedAt) continue;
        const created = this.makeEntry(link);
        this.entries.set(link.id, created);
        void this.connect(created);
        continue;
      }
      entry.link = link;
      if (link.revokedAt && entry.state !== 'revoked') this.markRevoked(entry, 'revoked in the link store');
    }
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        this.teardown(entry);
        this.entries.delete(id);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.entries.values()) this.teardown(entry);
    this.entries.clear();
  }

  /** Reset back-off, clear `unsupported`, probe now. Returns false for an unknown or revoked link. */
  reconnect(linkId: string): boolean {
    const entry = this.entries.get(linkId);
    if (!entry || entry.state === 'revoked') return false;
    this.clearTimer(entry, 'retryTimer');
    entry.attempt = 0;
    entry.backoffKind = 'network';
    if (entry.state === 'unsupported') {
      entry.state = entry.channel ? 'online' : 'offline';
      entry.stateDetail = null;
      entry.unsupported = null;
    }
    if (!entry.channel) void this.connect(entry);
    else void this.probeBetter(entry);
    return true;
  }

  /** `GET /api/machines` view inputs. */
  status(linkId: string): ReturnType<LinkStatusSource['status']> {
    const entry = this.entries.get(linkId);
    if (!entry) {
      return { state: 'connecting', stateDetail: null, currentRoute: null, lastHeartbeatAt: null, incident: null, peerVersion: null, ...UNKNOWN_PEER_MACHINE_FACTS, unsupported: null, routeStatus: () => 'untried' };
    }
    return {
      state: entry.state,
      stateDetail: entry.stateDetail,
      currentRoute: entry.currentRoute,
      lastHeartbeatAt: entry.lastHeartbeatAt === null ? null : new Date(entry.lastHeartbeatAt).toISOString(),
      incident: entry.incident,
      peerVersion: entry.peerVersion,
      ...entry.machine,
      unsupported: entry.unsupported,
      routeStatus: (url) => (url === entry.currentRoute && entry.state === 'online' ? 'current' : entry.routeStatus.get(url) ?? 'untried'),
    };
  }

  // ── LinkRouteSource ────────────────────────────────────────────────────────

  routeFor(environmentId: string): LinkRouteInfo | null {
    const entry = this.entryForEnvironment(environmentId);
    if (!entry) return null;
    return {
      state: entry.state,
      url: entry.state === 'online' ? (entry.currentRoute as TransportUrl | null) : null,
      machineKey: entry.link.machineKey,
      token: entry.link.token,
      label: entry.link.label,
    };
  }

  waitOnline(environmentId: string, timeoutMs: number): Promise<boolean> {
    const entry = this.entryForEnvironment(environmentId);
    if (!entry) return Promise.resolve(false);
    if (entry.state === 'online') return Promise.resolve(true);
    if (entry.state === 'revoked' || entry.state === 'unsupported') return Promise.resolve(false);
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const waiter = (online: boolean): void => {
        if (timer) clearTimeout(timer);
        entry.onlineWaiters.delete(waiter);
        resolve(online);
      };
      timer = setTimeout(() => waiter(false), timeoutMs);
      entry.onlineWaiters.add(waiter);
    });
  }

  localKey(): Promise<MachineKeyPair> {
    return this.deps.localKey();
  }

  /** WI-19: the link's routes changed (advertised endpoints); re-rank and keep going. */
  updateRoutes(linkId: string, routes: LinkRoute[]): void {
    const entry = this.entries.get(linkId);
    if (!entry) return;
    entry.link = { ...entry.link, routes };
    for (const url of [...entry.routeStatus.keys()]) {
      if (!routes.some((route) => route.url === url)) entry.routeStatus.delete(url);
    }
    // Probe at once when a better route was added or the route we are on vanished
    // (the channel stays until it fails); a no-op when we are already on the best.
    if (entry.state === 'online') this.scheduleBetter(entry, 0);
  }

  /** The directory's routes for a link right now (the Machines view lists them). */
  dynamicRoutes(linkId: string): LinkRoute[] {
    const entry = this.entries.get(linkId);
    return entry ? this.directoryRoutes(entry) : [];
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private directoryRoutes(entry: Entry): LinkRoute[] {
    try {
      return this.deps.dynamicRoutes?.(entry.link) ?? [];
    } catch {
      return [];
    }
  }

  /** Stored routes plus the directory's dynamic ones, deduplicated by URL (stored first). */
  private allRoutes(entry: Entry): LinkRoute[] {
    const stored = entry.link.routes;
    const known = new Set(stored.map((route) => route.url));
    return [...stored, ...this.directoryRoutes(entry).filter((route) => !known.has(route.url))];
  }

  /**
   * D-2356-8: stored-kind routes first; `direct` only when that found nothing and no peer refused
   * our key; `relay` last. A failure with no relay to fall back on, because the plan has none, is
   * reported as NO_DIRECT_PATH_MESSAGE.
   */
  private async probePhased(entry: Entry, signal: AbortSignal): Promise<ProbeOutcome> {
    const routes = this.allRoutes(entry);
    const phase1 = routes.filter((route) => !isWebRtc(route));
    const direct = routes.filter((route) => route.kind === 'direct');
    const relay = routes.filter((route) => route.kind === 'relay');
    let outcome: ProbeOutcome | null = null;
    if (phase1.length > 0 || (direct.length === 0 && relay.length === 0)) {
      outcome = await this.probe(entry, phase1, signal);
      if (outcome.ok || outcome.failure === 'unknown-peer' || outcome.failure === 'unsupported' || signal.aborted) return outcome;
    }
    if (direct.length > 0) {
      const second = await this.probe(entry, direct, signal);
      if (second.ok || second.failure === 'unknown-peer' || second.failure === 'unsupported' || signal.aborted) return second;
      outcome = joinFailures(outcome, second);
    }
    if (relay.length > 0) {
      const third = await this.probe(entry, relay, signal);
      if (third.ok || third.failure === 'unsupported' || signal.aborted) return third;
      return joinFailures(outcome, third);
    }
    if (direct.length > 0 && this.deps.relayEntitled?.() === false && outcome && !outcome.ok && outcome.failure === 'unreachable') {
      return { ok: false, failure: 'unreachable', detail: NO_DIRECT_PATH_MESSAGE, lanBlocked: outcome.lanBlocked };
    }
    return outcome ?? { ok: false, failure: 'unreachable', detail: 'no routes' };
  }

  private entryForEnvironment(environmentId: string): Entry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.link.environmentId === environmentId) return entry;
    }
    return undefined;
  }

  private makeEntry(link: MachineLink): Entry {
    return {
      link, state: 'connecting', stateDetail: null, unsupported: null, currentRoute: null, channel: null, heartbeat: null,
      lastHeartbeatAt: null, lastEndpointsHash: null, incident: null, peerVersion: null, machine: UNKNOWN_PEER_MACHINE_FACTS, attempt: 0,
      backoffKind: 'network', retryTimer: null, lateTimer: null, deadTimer: null, betterTimer: null,
      probing: null, routeStatus: new Map(), onlineWaiters: new Set(), generation: 0,
    };
  }

  private clearTimer(entry: Entry, key: 'retryTimer' | 'lateTimer' | 'deadTimer' | 'betterTimer'): void {
    const timer = entry[key];
    if (timer) clearTimeout(timer);
    entry[key] = null;
  }

  private settleWaiters(entry: Entry, online: boolean): void {
    for (const waiter of [...entry.onlineWaiters]) waiter(online);
  }

  private teardown(entry: Entry): void {
    entry.generation += 1;
    this.clearTimer(entry, 'retryTimer');
    this.clearTimer(entry, 'lateTimer');
    this.clearTimer(entry, 'deadTimer');
    this.clearTimer(entry, 'betterTimer');
    entry.probing?.abort();
    entry.probing = null;
    this.dropChannel(entry);
    this.settleWaiters(entry, false);
  }

  private dropChannel(entry: Entry): void {
    entry.heartbeat?.close();
    entry.heartbeat = null;
    entry.channel?.destroy();
    entry.channel = null;
    entry.currentRoute = null;
  }

  private markRevoked(entry: Entry, detail: string): void {
    entry.state = 'revoked';
    entry.stateDetail = detail;
    this.teardown(entry);
    void this.deps.markLinkRevoked(entry.link.id).catch(() => undefined);
    this.deps.log(`link to ${entry.link.label} revoked: ${detail}`);
  }

  private markUnsupported(entry: Entry, install: UnsupportedInstall): void {
    entry.state = 'unsupported';
    entry.unsupported = install;
    entry.stateDetail = unsupportedDetail(install, entry.link.label);
    this.clearTimer(entry, 'retryTimer');
    this.clearTimer(entry, 'betterTimer');
    this.dropChannel(entry);
    this.settleWaiters(entry, false);
  }

  private backoffMs(entry: Entry): number {
    const cap = entry.backoffKind === 'identity' ? IDENTITY_BACKOFF_CAP_MS : BACKOFF_CAP_MS;
    const base = Math.min(cap, BACKOFF_MIN_MS * 2 ** entry.attempt);
    const jitter = (this.deps.random() * 2 - 1) * BACKOFF_JITTER;
    return Math.round(base * (1 + jitter));
  }

  private scheduleRetry(entry: Entry): void {
    if (this.stopped || entry.state === 'revoked' || entry.state === 'unsupported') return;
    this.clearTimer(entry, 'retryTimer');
    const delay = this.backoffMs(entry);
    entry.attempt += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      void this.connect(entry);
    }, delay);
    entry.retryTimer.unref?.();
  }

  private scheduleBetter(entry: Entry, delay = BETTER_ROUTE_INTERVAL_MS): void {
    this.clearTimer(entry, 'betterTimer');
    const ranked = rankRoutes(this.allRoutes(entry));
    if (ranked.length === 0 || ranked[0]!.url === entry.currentRoute) return;
    entry.betterTimer = setTimeout(() => {
      entry.betterTimer = null;
      void this.probeBetter(entry);
    }, delay);
    entry.betterTimer.unref?.();
  }

  private armWatchdog(entry: Entry): void {
    this.clearTimer(entry, 'lateTimer');
    this.clearTimer(entry, 'deadTimer');
    const generation = entry.generation;
    entry.lateTimer = setTimeout(() => {
      entry.lateTimer = null;
      if (entry.generation !== generation || entry.state !== 'online') return;
      entry.state = 'connecting';
      entry.stateDetail = 'heartbeat late';
      // Probe every route while the old channel stays open (D-4645-7).
      void this.connect(entry, { keepChannel: true });
    }, HEARTBEAT_LATE_MS);
    entry.lateTimer.unref?.();
    entry.deadTimer = setTimeout(() => {
      entry.deadTimer = null;
      if (entry.generation !== generation) return;
      if (entry.state === 'online' || entry.state === 'connecting') {
        this.dropChannel(entry);
        if (!entry.probing) {
          entry.state = 'offline';
          entry.stateDetail = 'no heartbeat for 20 s';
          this.settleWaiters(entry, false);
          this.scheduleRetry(entry);
        } else {
          entry.state = 'connecting';
          entry.stateDetail = 'no heartbeat for 20 s; probing routes';
        }
      }
    }, HEARTBEAT_DEAD_MS);
    entry.deadTimer.unref?.();
  }

  /** Probe every route in parallel; first success in rank order wins, the rest are closed. */
  private async probe(entry: Entry, routes: readonly LinkRoute[], signal: AbortSignal): Promise<ProbeOutcome> {
    const ranked = rankRoutes(routes);
    if (ranked.length === 0) return { ok: false, failure: 'unreachable', detail: 'no routes' };
    let localKey: MachineKeyPair;
    try {
      localKey = await this.deps.localKey();
    } catch (error) {
      return { ok: false, failure: 'unreachable', detail: `machine key unavailable: ${(error as Error).message}` };
    }
    const attempts = ranked.map((route) =>
      this.deps.openChannel(route.url as TransportUrl, {
        mode: 'link', localKey, remoteKeyHex: entry.link.machineKey, timeoutMs: probeTimeoutFor(route), signal,
      }).then(
        (channel) => ({ route, channel, error: null as ChannelOpenError | Error | null }),
        (error: ChannelOpenError | Error) => ({ route, channel: null as ChannelSocket | null, error }),
      ));
    let winner: { route: LinkRoute; channel: ChannelSocket } | null = null;
    const failures: Array<{ route: LinkRoute; error: ChannelOpenError | Error }> = [];
    for (const attempt of attempts) {
      const settled = await attempt;
      if (settled.channel) {
        if (winner || signal.aborted) {
          settled.channel.destroy();
          if (!winner) entry.routeStatus.set(settled.route.url, 'reachable');
        } else {
          winner = { route: settled.route, channel: settled.channel };
          entry.routeStatus.set(settled.route.url, 'reachable');
        }
      } else if (settled.error) {
        failures.push({ route: settled.route, error: settled.error });
        entry.routeStatus.set(settled.route.url, 'unreachable');
      }
    }
    const codeOf = (error: Error): string | null => (error instanceof ChannelOpenError ? error.code : null);
    const unknownPeer = failures.find((failure) => codeOf(failure.error) === 'unknown-peer');
    if (unknownPeer) {
      winner?.channel.destroy();
      return { ok: false, failure: 'unknown-peer', detail: `${unknownPeer.route.url} does not hold a machine token for this machine` };
    }
    if (winner) return { ok: true, channel: winner.channel, route: winner.route };
    const unsupported = failures.find((failure) => codeOf(failure.error) === 'unsupported');
    if (unsupported) {
      const detail = (unsupported.error as ChannelOpenError).detail;
      return { ok: false, failure: 'unsupported', install: unsupportedInstall(detail.linkProtocol, detail.serverVersion, this.deps.serverVersion) };
    }
    // A responder that cannot decrypt our pinned-key handshake drops the connection
    // without a word; so does a proxy or port forward whose peer is dead. Only when
    // every route behaves that way is it treated as a key mismatch (300 s back-off).
    if (failures.length > 0 && failures.every((failure) => codeOf(failure.error) === 'identity-refused')) {
      return { ok: false, failure: 'identity-refused', detail: `${failures.map((failure) => failure.route.url).join(', ')} closed the connection before proving the pinned machine key` };
    }
    const lanBlocked = lanHostUnreachableRoutes(failures.map((failure) => ({
      url: failure.route.url,
      cause: failure.error instanceof ChannelOpenError ? failure.error.detail.cause : undefined,
    })));
    return {
      ok: false,
      failure: 'unreachable',
      detail: failures.map((failure) => `${failure.route.url}: ${failure.error.message}`).join('; ') || 'no route answered',
      lanBlocked: lanBlocked.length > 0 ? lanBlocked : undefined,
    };
  }

  private async connect(entry: Entry, opts: { keepChannel?: boolean } = {}): Promise<void> {
    if (this.stopped || entry.state === 'revoked' || entry.state === 'unsupported' || entry.probing) return;
    const generation = entry.generation;
    if (!opts.keepChannel) {
      this.dropChannel(entry);
      entry.state = 'connecting';
    }
    const controller = new AbortController();
    entry.probing = controller;
    const outcome = await this.probePhased(entry, controller.signal);
    if (entry.probing === controller) entry.probing = null;
    if (entry.generation !== generation || controller.signal.aborted) {
      if (outcome.ok) outcome.channel.destroy();
      return;
    }
    if (!outcome.ok) {
      if (outcome.failure === 'unknown-peer') return this.markRevoked(entry, outcome.detail);
      if (outcome.failure === 'unsupported') return this.markUnsupported(entry, outcome.install);
      let detail = outcome.detail;
      if (outcome.failure === 'unreachable' && outcome.lanBlocked?.length && this.deps.localNetworkAccess) {
        const access = await this.deps.localNetworkAccess();
        // markUnsupported doesn't bump `generation`, so re-check `entry.state` too; the cast works
        // around TS treating it as still excluding 'revoked'/'unsupported' from this function's
        // entry guard, even though either can land here during the await above.
        const stateNow = entry.state as LinkState;
        if (this.stopped || entry.generation !== generation || stateNow === 'revoked' || stateNow === 'unsupported') return;
        if (access === 'denied') {
          this.deps.log(`${entry.link.label}: local network check denied; raw detail: ${outcome.detail}`);
          detail = localNetworkBlockedDetail(this.deps.nodePath ?? 'node', outcome.lanBlocked);
        }
      }
      entry.backoffKind = outcome.failure === 'identity-refused' ? 'identity' : 'network';
      if (!entry.channel) {
        entry.state = 'offline';
        entry.stateDetail = detail;
        this.settleWaiters(entry, false);
        this.scheduleRetry(entry);
      }
      return;
    }
    await this.adopt(entry, outcome.channel, outcome.route, generation);
  }

  /** Verify the peer through the new channel, open its heartbeat, and make it the link's channel. */
  private async adopt(entry: Entry, channel: ChannelSocket, route: LinkRoute, generation: number): Promise<void> {
    let descriptor: EnvironmentDescriptor;
    try {
      const response = await this.deps.channelRequest(channel, 'GET', '/api/environment');
      const decoded = decodeDescriptor(response.json);
      if (response.status !== 200 || decoded._tag === 'None') throw new Error(`descriptor unavailable (status ${response.status})`);
      descriptor = decoded.value;
    } catch (error) {
      channel.destroy();
      if (entry.generation !== generation) return;
      entry.backoffKind = 'network';
      if (!entry.channel) {
        entry.state = 'offline';
        entry.stateDetail = `${route.url}: ${(error as Error).message}`;
        this.settleWaiters(entry, false);
        this.scheduleRetry(entry);
      }
      return;
    }
    if (entry.generation !== generation) {
      channel.destroy();
      return;
    }
    if (descriptor.environmentId !== entry.link.environmentId) {
      channel.destroy();
      entry.backoffKind = 'identity';
      if (!entry.channel) {
        entry.state = 'offline';
        entry.stateDetail = `${route.url} answers as another machine (${descriptor.label})`;
        this.settleWaiters(entry, false);
        this.scheduleRetry(entry);
      }
      return;
    }
    entry.peerVersion = descriptor.serverVersion;
    if (descriptor.capabilities.machineLinks !== true || descriptor.linkProtocol !== LINK_PROTOCOL_VERSION) {
      channel.destroy();
      return this.markUnsupported(entry, unsupportedInstall(descriptor.linkProtocol, descriptor.serverVersion, this.deps.serverVersion));
    }

    let heartbeat: HeartbeatHandle;
    try {
      heartbeat = await this.deps.openHeartbeat(channel, entry.link.token, {
        onHeartbeat: (payload) => this.onHeartbeat(entry, channel, payload),
        onEnd: (end) => this.onHeartbeatEnd(entry, channel, end),
      });
    } catch (error) {
      channel.destroy();
      if (entry.generation !== generation) return;
      const status = (error as { status?: number }).status;
      if (status === 401) return this.markRevoked(entry, `${entry.link.label} no longer accepts this machine's token`);
      entry.backoffKind = 'network';
      if (!entry.channel) {
        entry.state = 'offline';
        entry.stateDetail = `heartbeat: ${(error as Error).message}`;
        this.settleWaiters(entry, false);
        this.scheduleRetry(entry);
      }
      return;
    }
    if (entry.generation !== generation) {
      heartbeat.close();
      channel.destroy();
      return;
    }
    // Swap in the new channel (the previous one, if any, is closed).
    entry.heartbeat?.close();
    entry.channel?.destroy();
    entry.channel = channel;
    entry.heartbeat = heartbeat;
    entry.currentRoute = route.url;
    entry.state = 'online';
    entry.stateDetail = null;
    entry.attempt = 0;
    entry.backoffKind = 'network';
    entry.lastHeartbeatAt = this.deps.now();
    this.clearTimer(entry, 'retryTimer');
    this.armWatchdog(entry);
    void this.applyDescriptor(entry, descriptor);
    this.scheduleBetter(entry);
    this.settleWaiters(entry, true);
    void this.deps.onDescriptor?.(entry.link, descriptor);
  }

  /** WI-19: merge the peer's advertised endpoints into the link's routes and persist when they changed. */
  private async applyDescriptor(entry: Entry, descriptor: EnvironmentDescriptor): Promise<void> {
    const merged = mergeAdvertised(entry.link.routes, descriptor.endpoints ?? []);
    const before = entry.link.routes.map((route) => `${route.source}:${route.url}`).sort().join('|');
    const after = merged.map((route) => `${route.source}:${route.url}`).sort().join('|');
    if (before === after) return;
    entry.link = { ...entry.link, routes: merged };
    for (const url of [...entry.routeStatus.keys()]) {
      if (!merged.some((route) => route.url === url)) entry.routeStatus.delete(url);
    }
    try {
      await this.deps.setLinkRoutes(entry.link.id, merged);
    } catch (error) {
      this.deps.log(`could not persist routes for ${entry.link.label}: ${(error as Error).message}`);
    }
    if (entry.state === 'online') this.scheduleBetter(entry);
  }

  private onHeartbeat(entry: Entry, channel: ChannelSocket, payload: HeartbeatPayload): void {
    if (entry.channel !== channel) return;
    const now = this.deps.now();
    if (entry.lastHeartbeatAt !== null) {
      const incident = diagnoseGap(now - entry.lastHeartbeatAt, payload.lastStall, now);
      if (incident) entry.incident = incident;
    }
    entry.lastHeartbeatAt = now;
    entry.peerVersion = payload.serverVersion;
    entry.machine = peerMachineFacts(payload);
    if (entry.state === 'connecting') {
      // The old channel is alive after all: stop probing and keep it.
      entry.probing?.abort();
      entry.probing = null;
      entry.state = 'online';
      entry.stateDetail = null;
      this.settleWaiters(entry, true);
    }
    this.armWatchdog(entry);
    if (entry.lastEndpointsHash !== null && entry.lastEndpointsHash !== payload.endpointsHash) {
      // The peer's advertised endpoints changed: refetch the descriptor and re-merge (WI-19).
      // The heartbeat channel is busy with its stream, so the read goes over a short-lived channel.
      void this.refetchDescriptor(entry, channel);
    }
    entry.lastEndpointsHash = payload.endpointsHash;
    void this.deps.onHeartbeat?.(entry.link, payload);
  }

  private async refetchDescriptor(entry: Entry, heartbeatChannel: ChannelSocket): Promise<void> {
    const url = entry.currentRoute;
    if (!url) return;
    let channel: ChannelSocket | null = null;
    try {
      const localKey = await this.deps.localKey();
      channel = await this.deps.openChannel(url as TransportUrl, {
        mode: 'link', localKey, remoteKeyHex: entry.link.machineKey, timeoutMs: PROBE_TIMEOUT_MS,
      });
      const response = await this.deps.channelRequest(channel, 'GET', '/api/environment');
      const decoded = decodeDescriptor(response.json);
      if (response.status === 200 && decoded._tag === 'Some' && entry.channel === heartbeatChannel) {
        await this.applyDescriptor(entry, decoded.value);
        void this.deps.onDescriptor?.(entry.link, decoded.value);
      }
    } catch (error) {
      this.deps.log(`could not refetch ${entry.link.label}'s descriptor: ${(error as Error).message}`);
    } finally {
      channel?.destroy();
    }
  }

  private onHeartbeatEnd(entry: Entry, channel: ChannelSocket, end: { status?: number; error?: Error }): void {
    if (entry.channel !== channel) return;
    if (end.status === 401) return this.markRevoked(entry, `${entry.link.label} no longer accepts this machine's token`);
    // The transport dropped: probe at once while the watchdog decides on offline.
    this.dropChannel(entry);
    entry.state = 'connecting';
    entry.stateDetail = end.error ? `heartbeat ended: ${end.error.message}` : 'heartbeat ended';
    this.clearTimer(entry, 'lateTimer');
    void this.connect(entry);
  }

  /** Try the routes ranked above the current one; switch on success. */
  private async probeBetter(entry: Entry): Promise<void> {
    if (this.stopped || entry.state !== 'online' || entry.probing) return;
    const ranked = rankRoutes(this.allRoutes(entry));
    const currentIndex = ranked.findIndex((route) => route.url === entry.currentRoute);
    const better = currentIndex <= 0 ? ranked.filter((route) => route.url !== entry.currentRoute) : ranked.slice(0, currentIndex);
    if (better.length === 0) return;
    const generation = entry.generation;
    const controller = new AbortController();
    entry.probing = controller;
    const outcome = await this.probe(entry, better, controller.signal);
    if (entry.probing === controller) entry.probing = null;
    if (entry.generation !== generation) {
      if (outcome.ok) outcome.channel.destroy();
      return;
    }
    if (!outcome.ok) {
      if (outcome.failure === 'unknown-peer') this.markRevoked(entry, outcome.detail);
      else this.scheduleBetter(entry);
      return;
    }
    await this.adopt(entry, outcome.channel, outcome.route, generation);
  }
}

/** The view fields a supervisor-backed status adds on top of the link record. */
export type SupervisedLinkView = Pick<MachineLinkView, 'state' | 'stateDetail' | 'currentRoute' | 'lastHeartbeatAt' | 'incident' | 'peerVersion' | 'load' | 'tags' | 'placement'>;
