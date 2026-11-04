/**
 * The connector's WebRTC dialer over the overdeck.ai directory (PAN-4927 W-CONN2, PAN-4950 FR-5, FR-6, NFR-9).
 *
 * A small client-role copy of the dashboard's `services/directory-rtc.ts`, which `src/lib/` must not
 * import: an `RtcTransport` whose signalling port is the connector's directory socket (`signal`
 * frames, purpose `link`; `ice-servers` requests), registered as the `rtc://` / `rtc+turn://`
 * dialer through `setRtcDialer`. The connector only dials; it never accepts an incoming channel.
 *
 * Relay metering: the directory counts relay bytes only from the initiator's `relay-usage` frames,
 * and the connector initiates every channel, so each relay channel is metered as the phone does
 * (`apps/mobile/src/shell/relayMeter.ts`): every 60 s and when the channel closes, at most 1e9
 * bytes per frame, unsent bytes kept while the socket refuses frames. A `relay-status` with
 * `stopped: true` closes every relay channel and refuses new relay dials with `RELAY_CAP_MESSAGE`.
 * Only ciphertext crosses either route; the secure channel runs on top.
 */
import type { Duplex } from 'node:stream';

import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import { RELAY_CAP_MESSAGE } from '@overdeck/contracts';

import { ChannelOpenError, type RtcDialer } from '../../anywhere/channel/open.js';
import { type IncomingRtcChannel, type RtcSignalingPort, RtcTransport } from '../../anywhere/channel/rtc-transport.js';

export const RELAY_REPORT_INTERVAL_MS = 60_000;
/** The directory accepts at most 1e9 bytes per report. */
export const MAX_REPORT_BYTES = 1_000_000_000;
export const RELAY_PLAN_MESSAGE = 'The relay needs the relay plan';

export type ConnectorDirectoryPort = Pick<DirectoryWebClient, 'send' | 'on' | 'iceServers' | 'state' | 'machines' | 'relayAllowed'>;

export function connectorSignalingPort(directory: Pick<DirectoryWebClient, 'send' | 'on' | 'iceServers'>): RtcSignalingPort {
  return {
    send(to, session, _purpose, relay, data) {
      directory.send({ type: 'signal', to, session, purpose: 'link', relay, data });
    },
    onSignal(handler) {
      return directory.on('signal', (frame) => handler(frame.from, frame.session, frame.purpose, frame.relay, frame.data));
    },
    // The contracts type is readonly; werift takes a mutable list.
    iceServers: async (relay) => (await directory.iceServers(relay)).map((server) => ({ ...server, urls: [...server.urls] })),
  };
}

/** A relayed raw duplex with its byte counters (an `RtcDuplex`). */
export interface MeteredRaw {
  readonly bytesIn: number;
  readonly bytesOut: number;
  once(event: 'close', listener: () => void): unknown;
}

export interface RelayMeter {
  track(raw: MeteredRaw): void;
  /** Report what is left and stop the timer. */
  stop(): void;
}

export function createRelayMeter(
  send: (bytes: number) => boolean,
  { intervalMs = RELAY_REPORT_INTERVAL_MS }: { intervalMs?: number } = {},
): RelayMeter {
  const tracked = new Set<{ raw: MeteredRaw; reported: number }>();
  /** Bytes taken from channels but not yet accepted by the directory socket. */
  let unsent = 0;

  const flush = (): void => {
    while (unsent > 0) {
      const chunk = Math.min(unsent, MAX_REPORT_BYTES);
      if (!send(chunk)) return;
      unsent -= chunk;
    }
  };
  const take = (entry: { raw: MeteredRaw; reported: number }): void => {
    const delta = entry.raw.bytesIn + entry.raw.bytesOut - entry.reported;
    if (delta <= 0) return;
    entry.reported += delta;
    unsent += delta;
  };
  const report = (): void => {
    for (const entry of tracked) take(entry);
    flush();
  };

  const timer = setInterval(report, intervalMs);
  timer.unref?.();

  return {
    track(raw) {
      const entry = { raw, reported: 0 };
      tracked.add(entry);
      raw.once('close', () => {
        tracked.delete(entry);
        take(entry);
        flush();
      });
    },
    stop() {
      clearInterval(timer);
      report();
      tracked.clear();
    },
  };
}

export type ConnectorTransport = Pick<RtcTransport, 'dial' | 'abortSession' | 'close'>;

export interface ConnectorRtc {
  readonly transport: ConnectorTransport;
  readonly dialer: RtcDialer;
  /** Why a relay dial is refused now, or null when it may go ahead. */
  relayRefusal(): string | null;
  stop(): void;
}

export function createConnectorRtc(
  directory: ConnectorDirectoryPort,
  deps: { transport?: (port: RtcSignalingPort, onIncoming: IncomingRtcChannel) => ConnectorTransport; meterIntervalMs?: number } = {},
): ConnectorRtc {
  const makeTransport = deps.transport ?? ((port, onIncoming) => new RtcTransport(port, onIncoming));
  const transport = makeTransport(connectorSignalingPort(directory), (raw) => raw.destroy());
  const meter = createRelayMeter((bytes) => directory.send({ type: 'relay-usage', bytes }), {
    ...(deps.meterIntervalMs !== undefined ? { intervalMs: deps.meterIntervalMs } : {}),
  });
  const relayRaws = new Set<Duplex>();
  let relayStopped = false;

  const offs = [
    // A `peer_offline` answer fails the pending dial at once instead of at the open timeout.
    directory.on('error', (frame) => {
      if (frame.code === 'peer_offline' && frame.session) transport.abortSession(frame.session);
    }),
    directory.on('relay-status', (frame) => {
      relayStopped = frame.stopped;
      if (!frame.stopped) return;
      for (const raw of [...relayRaws]) raw.destroy();
      relayRaws.clear();
    }),
  ];

  const relayRefusal = (): string | null => {
    if (!directory.relayAllowed) return RELAY_PLAN_MESSAGE;
    if (relayStopped) return RELAY_CAP_MESSAGE;
    return null;
  };

  const dialer: RtcDialer = async (url, signal) => {
    const relay = url.startsWith('rtc+turn://');
    const environmentId = url.slice(relay ? 'rtc+turn://'.length : 'rtc://'.length);
    if (directory.state !== 'online') throw new ChannelOpenError('unreachable', 'Not connected to the overdeck.ai directory');
    if (directory.machines.find((machine) => machine.environmentId === environmentId)?.online !== true) {
      throw new ChannelOpenError('unreachable', 'The machine is not online in the overdeck.ai directory');
    }
    if (relay) {
      const refused = relayRefusal();
      if (refused) throw new ChannelOpenError('unreachable', refused);
    }
    const raw = await transport.dial(environmentId, { relay, purpose: 'link', signal });
    if (relay) {
      meter.track(raw as Duplex & MeteredRaw);
      relayRaws.add(raw);
      raw.once('close', () => relayRaws.delete(raw));
    }
    return raw;
  };

  return {
    transport,
    dialer,
    relayRefusal,
    stop() {
      for (const off of offs) off();
      meter.stop();
      transport.close();
    },
  };
}
