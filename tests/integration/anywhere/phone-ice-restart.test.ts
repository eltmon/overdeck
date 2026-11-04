/**
 * PAN-5046 WI-7: two network changes in a row, end to end. The phone's real dialer
 * (`createMachineDialer`, werift peer connections) and the machine's real `RtcTransport` +
 * channel listener, joined by an in-memory directory that stamps `from`. Each "network change" is
 * an ICE restart on the same session; the same secure channel must keep serving requests and the
 * machine must never replace the session. Real timers: the subject is real UDP I/O.
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import type { Duplex } from 'node:stream';

import type { ClientToDirectoryFrame, DirectoryToClientFrame, SignalData } from '@overdeck/contracts';
import {
  type ChannelPool,
  type ChannelStream,
  type ClientSignaling,
  createChannelPool,
  createMachineDialer,
  type MachineDialer,
  openSecureChannel,
  type RtcDuplexWeb,
} from '@overdeck/anywhere-channel/web';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RTCPeerConnection as WeriftPeerConnection } from 'werift';

import type { MachineKeyPair } from '../../../src/lib/anywhere/machine-key.js';
import { _resetChannelListenerForTests, acceptRawChannel, installChannelListener } from '../../../src/dashboard/server/channel-listener.js';
import { type RtcPurpose, type RtcSignalingPort, RtcTransport } from '../../../src/lib/anywhere/channel/rtc-transport.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const MACHINE = '00000000-0000-4000-8000-0000000000aa';
const PHONE = '00000000-0000-4000-8000-0000000000bb';

const machineKey = dh.generateKeyPair();
const phoneKey = dh.generateKeyPair();

/**
 * werift stands in for the phone's browser peer connection. As the offerer, werift resets its ICE
 * agent on an ICE restart but skips the new connectivity checks while DTLS is still connected; a
 * browser runs them itself. Start them once a restart answer is applied so the stand-in behaves
 * like the phone.
 */
class PhonePeerConnection extends WeriftPeerConnection {
  private answers = 0;

  override async setRemoteDescription(description: Parameters<WeriftPeerConnection['setRemoteDescription']>[0]) {
    const result = await super.setRemoteDescription(description);
    if (description.type === 'answer' && ++this.answers > 1) {
      for (const transport of this.iceTransports) void transport.start().catch(() => {});
    }
    return result;
  }
}

/** The directory between one phone and one machine: delivers each signal on a later turn, stamping `from`. */
function directory() {
  const phoneHandlers = new Map<string, Set<(frame: DirectoryToClientFrame) => void>>();
  const machineHandlers = new Set<Parameters<RtcSignalingPort['onSignal']>[0]>();
  /** Offers the phone sent, in order. */
  const offers: Array<{ session: string }> = [];
  const phone = {
    send: (frame: ClientToDirectoryFrame) => {
      if (frame.type !== 'signal') return true;
      if (frame.data.sdp?.type === 'offer') offers.push({ session: frame.session });
      setImmediate(() => {
        for (const handler of [...machineHandlers]) handler(PHONE, frame.session, frame.purpose as RtcPurpose, frame.relay, frame.data);
      });
      return true;
    },
    on: (type: string, handler: (frame: DirectoryToClientFrame) => void) => {
      const set = phoneHandlers.get(type) ?? new Set();
      set.add(handler);
      phoneHandlers.set(type, set);
      return () => set.delete(handler);
    },
    iceServers: async () => [],
  } as unknown as ClientSignaling;
  const machine: RtcSignalingPort = {
    send(_to, session, purpose, relay, data: SignalData) {
      setImmediate(() => {
        const frame = { type: 'signal', from: MACHINE, session, purpose, relay, data } as DirectoryToClientFrame;
        for (const handler of [...(phoneHandlers.get('signal') ?? [])]) handler(frame);
      });
    },
    onSignal(handler) {
      machineHandlers.add(handler);
      return () => machineHandlers.delete(handler);
    },
    iceServers: async () => [],
  };
  return { phone, machine, offers };
}

let server: http.Server;
let transport: RtcTransport;
let dialer: MachineDialer;
let channels: ChannelPool | null;
let net: ReturnType<typeof directory>;
let machineLog: string[];
let phoneLog: string[];

beforeEach(async () => {
  _resetChannelListenerForTests();
  server = http.createServer((_req, res) => res.end('hello'));
  installChannelListener(server, {
    primary: true,
    localKey: async () => machineKey,
    isPinnedPeer: (key) => key === phoneKey.publicKey.toString('hex'),
    takePairing: () => 'unknown',
    onPairingFailure: () => {},
    log: () => {},
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  net = directory();
  machineLog = [];
  phoneLog = [];
  const log = (message: string) => machineLog.push(message);
  transport = new RtcTransport(net.machine, (raw: Duplex) => void acceptRawChannel(raw), { log, debug: log });
  dialer = createMachineDialer(net.phone, {
    RTCPeerConnection: PhonePeerConnection as unknown as typeof RTCPeerConnection,
    log: (message) => phoneLog.push(message),
  });
  channels = null;
});

afterEach(async () => {
  channels?.close();
  dialer.close();
  transport.close();
  _resetChannelListenerForTests();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('phone ICE restart against the machine (PAN-5046 WI-7)', () => {
  it('keeps one secure channel serving requests across two ICE restarts on the same session', async () => {
    let dials = 0;
    const dial = async (): Promise<ChannelStream> => {
      dials += 1;
      const raw = await dialer.dialMachine(MACHINE, { relay: false });
      return (await openSecureChannel(raw, { mode: 'link', localKey: phoneKey, remoteKeyHex: machineKey.publicKey.toString('hex') })).stream;
    };
    channels = createChannelPool({ dial });
    const hello = async () => new TextDecoder().decode((await channels!.request({ method: 'GET', path: '/api/hello' })).body);

    expect(await hello()).toBe('hello');
    expect(net.offers).toHaveLength(1);
    const session = net.offers[0]!.session;

    await dialer.restartIce(MACHINE);
    expect(await hello()).toBe('hello');
    await dialer.restartIce(MACHINE);
    expect(await hello()).toBe('hello');

    expect(dials).toBe(1);
    expect(net.offers.map((offer) => offer.session)).toEqual([session, session, session]);
    expect(machineLog.filter((line) => line.includes('ice restart from'))).toHaveLength(2);
    expect(machineLog.filter((line) => line.includes('a new offer replaced it'))).toHaveLength(0);
    expect(phoneLog.filter((line) => line.endsWith('ice restart sent'))).toHaveLength(2);
    expect(transport.peerConnectionCount()).toBe(1);
  }, 30_000);

  it('evicting a raw channel from a closed connection sends no new offer', async () => {
    const stale: RtcDuplexWeb = await dialer.dialMachine(MACHINE, { relay: false });
    stale.on('error', () => {});
    dialer.close(MACHINE);
    const fresh = await dialer.dialMachine(MACHINE, { relay: false });
    fresh.on('error', () => {});
    expect(net.offers).toHaveLength(2);

    dialer.evict(stale, 'secure open timeout');
    const again = await dialer.dialMachine(MACHINE, { relay: false });

    expect(net.offers).toHaveLength(2);
    expect(again.destroyed).toBe(false);
    expect(fresh.destroyed).toBe(false);
  }, 30_000);
});
