import { describe, expect, it } from 'vitest';
import { CLIENT_LIMIT_MESSAGE, CONNECTOR_LIMIT_MESSAGE, RELAY_MONTHLY_CAP_BYTES } from '../../../../packages/contracts/src/connect.ts';
import type { ClientToDirectoryFrame, MachineToDirectoryFrame } from '../../../../packages/contracts/src/connect.ts';
import { reduceClient } from '../../../../services/connect/src/client-state.ts';
import type { ClientEvent } from '../../../../services/connect/src/client-state.ts';
import { EMPTY_DIRECTORY, reduce } from '../../../../services/connect/src/directory-state.ts';
import type { DirectoryEffect, DirectoryState, ReduceContext, SocketIdentity } from '../../../../services/connect/src/directory-state.ts';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const FREE: SocketIdentity = { deviceId: 'd-1', plan: 'free', maxDevices: 3 };
const TESTER: SocketIdentity = { deviceId: 'd-1', plan: 'tester', maxDevices: null };
const env = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const cid = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`;
const LABEL_MARKER = 'PHONE-LABEL-MARKER';
const PHONE_KEY = 'ab'.repeat(32);

function ctx(over: Partial<ReduceContext> = {}): ReduceContext {
  return { now: NOW, online: new Set(), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false, ...over };
}

function machineHello(n: number): Extract<MachineToDirectoryFrame, { type: 'hello' }> {
  return {
    type: 'hello',
    protocol: 1,
    environmentId: env(n),
    label: `machine-${n}`,
    publicKeyHex: n.toString(16).padStart(2, '0').repeat(32),
    serverVersion: '0.72.0',
    linkProtocol: 1,
    endpoints: [],
  };
}

function machines(count: number, identity = FREE): DirectoryState {
  let state = EMPTY_DIRECTORY;
  for (let n = 1; n <= count; n++) {
    state = reduce(state, { kind: 'hello', registeredAs: null, identity, frame: machineHello(n), fingerprint: `fp-${n}` }, ctx()).state;
  }
  return state;
}

function helloClientFrame(n: number): Extract<ClientToDirectoryFrame, { type: 'hello-client' }> {
  return { type: 'hello-client', protocol: 1, clientId: cid(n), label: `${LABEL_MARKER}-${n}`, publicKeyHex: PHONE_KEY, appVersion: '1.0.0', platform: 'ios' };
}

function helloClient(state: DirectoryState, n: number, identity = FREE, over: Partial<ReduceContext> = {}) {
  const event: ClientEvent = { kind: 'hello-client', registeredAs: null, identity, frame: helloClientFrame(n) };
  return reduceClient(state, event, ctx(over));
}

function phones(state: DirectoryState, count: number, identity = FREE): DirectoryState {
  let next = state;
  for (let n = 1; n <= count; n++) next = helloClient(next, n, identity).state;
  return next;
}

function nodeHelloFrame(n: number): Extract<ClientToDirectoryFrame, { type: 'hello-client' }> {
  return { ...helloClientFrame(n), platform: 'node' };
}

function helloNode(state: DirectoryState, n: number, identity = FREE, over: Partial<ReduceContext> = {}) {
  const event: ClientEvent = { kind: 'hello-client', registeredAs: null, identity, frame: nodeHelloFrame(n) };
  return reduceClient(state, event, ctx(over));
}

function connectors(state: DirectoryState, count: number, identity = FREE): DirectoryState {
  let next = state;
  for (let n = 101; n <= 100 + count; n++) next = helloNode(next, n, identity).state;
  return next;
}

const sends = (effects: DirectoryEffect[]) => effects.filter((e) => e.kind === 'send');
const closes = (effects: DirectoryEffect[]) => effects.filter((e) => e.kind === 'close');
const logs = (effects: DirectoryEffect[]) => effects.filter((e) => e.kind === 'log');

describe('client reducer: registration and the 5-phone cap (PAN-4829 WI-3)', () => {
  it('registers a phone on a free account that already has 3 machines, without using a machine slot', () => {
    const state = machines(3);
    const online = new Set([env(1), env(2), env(3)]);
    const { state: next, effects } = helloClient(state, 1, FREE, { online });
    expect(next.machines).toHaveLength(3);
    expect(next.clients.map((c) => c.clientId)).toEqual([cid(1)]);
    expect(effects).toContainEqual({ kind: 'register-client', clientId: cid(1) });
    expect(effects.find((e) => e.kind === 'put-client')).toMatchObject({
      row: { clientId: cid(1), platform: 'ios', appVersion: '1.0.0', deviceId: 'd-1', registeredAt: NOW, lastSeenAt: NOW },
    });
    const welcome = sends(effects)[0];
    expect(welcome).toMatchObject({ to: 'self', frame: { type: 'welcome-client', protocol: 1, plan: 'free', relayAllowed: false } });
    const listed = (welcome?.frame as { machines: Array<{ environmentId: string; online: boolean }> }).machines;
    expect(listed.map((m) => [m.environmentId, m.online])).toEqual([
      [env(1), true],
      [env(2), true],
      [env(3), true],
    ]);
    expect(effects.some((e) => e.kind === 'put-machine' || e.kind === 'register')).toBe(false);
  });

  it('refuses a sixth new phone with the exact client_limit message and close 4013', () => {
    const state = phones(machines(3), 5);
    const { state: next, effects } = helloClient(state, 6);
    expect(next.clients).toHaveLength(5);
    expect(sends(effects)).toEqual([{ kind: 'send', to: 'self', frame: { type: 'error', code: 'client_limit', message: CLIENT_LIMIT_MESSAGE } }]);
    expect(closes(effects)).toEqual([{ kind: 'close', to: 'self', code: 4013, reason: 'client limit' }]);
    expect(effects.some((e) => e.kind === 'put-client' || e.kind === 'register-client')).toBe(false);
  });

  it('lets a known phone re-register when 5 rows exist', () => {
    const state = phones(EMPTY_DIRECTORY, 5);
    const { state: next, effects } = helloClient(state, 3);
    expect(next.clients).toHaveLength(5);
    expect(effects).toContainEqual({ kind: 'register-client', clientId: cid(3) });
    expect(logs(effects)).toContainEqual(expect.objectContaining({ outcome: 'updated', clientId: cid(3) }));
  });

  it('caps phones at 5 on the tester plan too', () => {
    const state = phones(machines(5, TESTER), 5, TESTER);
    const { effects } = helloClient(state, 6, TESTER);
    expect(closes(effects)).toEqual([{ kind: 'close', to: 'self', code: 4013, reason: 'client limit' }]);
  });

  it('closes an older socket of the same phone with 4011', () => {
    const state = phones(EMPTY_DIRECTORY, 1);
    const { effects } = helloClient(state, 1, FREE, { onlineClients: new Set([cid(1)]) });
    expect(closes(effects)).toEqual([{ kind: 'close', to: { clientId: cid(1) }, code: 4011, reason: 'replaced' }]);
  });

  it('refreshes the stored plan on a phone hello', () => {
    const { effects } = helloClient(EMPTY_DIRECTORY, 1, TESTER);
    expect(effects).toContainEqual({ kind: 'put-plan', plan: 'tester' });
  });

  it('forgets a phone on a full account and frees its slot at once', () => {
    const state = phones(EMPTY_DIRECTORY, 5);
    const forgotten = reduceClient(state, { kind: 'client-frame', clientId: cid(2), frame: { type: 'forget-client' } }, ctx());
    expect(forgotten.state.clients.map((c) => c.clientId)).toEqual([cid(1), cid(3), cid(4), cid(5)]);
    expect(forgotten.effects).toContainEqual({ kind: 'delete-client', clientId: cid(2) });
    expect(closes(forgotten.effects)).toEqual([{ kind: 'close', to: 'self', code: 4012, reason: 'forgotten' }]);
    expect(helloClient(forgotten.state, 6).state.clients).toHaveLength(5);
  });

  it('still closes an unknown phone with 4012 on forget-client', () => {
    const { effects } = reduceClient(EMPTY_DIRECTORY, { kind: 'client-frame', clientId: cid(9), frame: { type: 'forget-client' } }, ctx());
    expect(closes(effects)).toEqual([{ kind: 'close', to: 'self', code: 4012, reason: 'forgotten' }]);
    expect(logs(effects)).toContainEqual(expect.objectContaining({ outcome: 'unknown_client' }));
  });

  it('marks a phone offline on client-gone and sends nothing', () => {
    const state = phones(EMPTY_DIRECTORY, 1);
    const later = NOW + 60_000;
    const { state: next, effects } = reduceClient(state, { kind: 'client-gone', clientId: cid(1) }, ctx({ now: later }));
    expect(next.clients[0]?.lastSeenAt).toBe(later);
    expect(effects).toContainEqual({ kind: 'put-client', row: expect.objectContaining({ clientId: cid(1), lastSeenAt: later }) });
    expect(sends(effects)).toEqual([]);
    expect(reduceClient(EMPTY_DIRECTORY, { kind: 'client-gone', clientId: cid(1) }, ctx()).effects).toEqual([]);
  });

  it('answers a repeated hello-client with bad_frame', () => {
    const event: ClientEvent = { kind: 'hello-client', registeredAs: cid(1), identity: FREE, frame: helloClientFrame(1) };
    const { effects } = reduceClient(phones(EMPTY_DIRECTORY, 1), event, ctx());
    expect(sends(effects)).toEqual([{ kind: 'send', to: 'self', frame: { type: 'error', code: 'bad_frame', message: 'hello was already sent on this socket' } }]);
    expect(closes(effects)).toEqual([]);
  });

  it('closes 4010 on an unsupported client frame and keeps the socket on bad_frame', () => {
    const unsupported = reduceClient(EMPTY_DIRECTORY, { kind: 'client-bad-frame', clientId: cid(1), reason: 'unsupported' }, ctx());
    expect(closes(unsupported.effects)).toEqual([{ kind: 'close', to: 'self', code: 4010, reason: 'unsupported' }]);
    const bad = reduceClient(EMPTY_DIRECTORY, { kind: 'client-bad-frame', clientId: cid(1), reason: 'bad_frame' }, ctx());
    expect(closes(bad.effects)).toEqual([]);
    expect(sends(bad.effects)).toEqual([{ kind: 'send', to: 'self', frame: { type: 'error', code: 'bad_frame', message: 'malformed frame' } }]);
  });

  it('never logs a phone label or key, and logs the client id with a null environment', () => {
    let state = machines(3);
    const all: DirectoryEffect[] = [];
    for (let n = 1; n <= 6; n++) {
      const result = helloClient(state, n);
      state = result.state;
      all.push(...result.effects);
    }
    all.push(...reduceClient(state, { kind: 'client-frame', clientId: cid(1), frame: { type: 'forget-client' } }, ctx()).effects);
    const logged = logs(all);
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain(LABEL_MARKER);
    expect(JSON.stringify(logged)).not.toContain(PHONE_KEY);
    for (const entry of logged) expect(entry).toMatchObject({ environmentId: null, clientId: expect.any(String) });
  });
});

describe('client reducer: connector cap, counted apart from phones (PAN-4927 D-18)', () => {
  it('registers 10 connectors alongside 3 machines and 5 phones; the 11th connector is refused, a 6th phone separately', () => {
    const state = connectors(phones(machines(3), 5), 10);
    expect(state.machines).toHaveLength(3);
    expect(state.clients).toHaveLength(15);

    const { effects: connectorEffects } = helloNode(state, 111);
    expect(sends(connectorEffects)).toEqual([{ kind: 'send', to: 'self', frame: { type: 'error', code: 'client_limit', message: CONNECTOR_LIMIT_MESSAGE } }]);
    expect(closes(connectorEffects)).toEqual([{ kind: 'close', to: 'self', code: 4013, reason: 'client limit' }]);

    const { effects: phoneEffects } = helloClient(state, 6);
    expect(sends(phoneEffects)).toEqual([{ kind: 'send', to: 'self', frame: { type: 'error', code: 'client_limit', message: CLIENT_LIMIT_MESSAGE } }]);
    expect(closes(phoneEffects)).toEqual([{ kind: 'close', to: 'self', code: 4013, reason: 'client limit' }]);
  });

  it('never gives a connector hello a machine slot, and keeps it out of machine frames', () => {
    const { effects } = helloNode(machines(3), 101);
    expect(effects.some((e) => e.kind === 'put-machine' || e.kind === 'register')).toBe(false);

    const state = connectors(machines(3), 10);
    const { effects: endpointsEffects } = reduce(state, { kind: 'frame', registeredAs: env(1), frame: { type: 'endpoints', endpoints: [] } }, ctx());
    const directoryFrames = sends(endpointsEffects).filter((e) => e.frame.type === 'welcome' || (e.frame.type === 'directory' && e.to !== 'clients'));
    expect(directoryFrames.length).toBeGreaterThan(0);
    for (const f of directoryFrames) {
      const machineIds = (f.frame as { machines: Array<{ environmentId: string }> }).machines.map((m) => m.environmentId);
      expect(machineIds).toEqual([env(1), env(2), env(3)]);
      expect(JSON.stringify(f.frame)).not.toContain(cid(101));
    }
  });

  it('recounts and clears push on a family change (D-2)', () => {
    const withPush = pushFrame(phones(EMPTY_DIRECTORY, 1), cid(1), { type: 'push-register', platform: 'ios', token: PUSH_TOKEN }).state;

    const full = connectors(withPush, 10);
    const { effects: refused } = helloNode(full, 1);
    expect(sends(refused)).toEqual([{ kind: 'send', to: 'self', frame: { type: 'error', code: 'client_limit', message: CONNECTOR_LIMIT_MESSAGE } }]);
    expect(closes(refused)).toEqual([{ kind: 'close', to: 'self', code: 4013, reason: 'client limit' }]);

    const withRoom = connectors(withPush, 9);
    const { state: next, effects: accepted } = helloNode(withRoom, 1);
    expect(next.clients.find((c) => c.clientId === cid(1))).toMatchObject({ platform: 'node', push: null });
    expect(accepted.find((e) => e.kind === 'put-client')).toMatchObject({ row: { clientId: cid(1), platform: 'node', push: null } });
  });
});

const SESSION = 'c'.repeat(32);
const SDP = { sdp: { type: 'offer' as const, sdp: 'v=0' } };

function clientSignal(clientId: string, to: string, over: Partial<ReduceContext> = {}, state = phones(machines(3), 2)) {
  return reduceClient(
    state,
    { kind: 'client-frame', clientId, frame: { type: 'signal', to, session: SESSION, purpose: 'link', relay: false, data: SDP } },
    ctx(over),
  );
}

function machineSignal(from: string, to: string, purpose: 'link' | 'approval', over: Partial<ReduceContext> = {}) {
  return reduce(
    phones(machines(3), 2),
    { kind: 'frame', registeredAs: from, frame: { type: 'signal', to, session: SESSION, purpose, relay: true, data: SDP } },
    ctx(over),
  );
}

describe('client reducer: signals, ICE servers and relay metering (PAN-4829 WI-4)', () => {
  it('forwards a phone signal to an online machine with from = the client id', () => {
    const { effects } = clientSignal(cid(1), env(2), { online: new Set([env(1), env(2)]) });
    expect(sends(effects)).toEqual([
      { kind: 'send', to: { environmentId: env(2) }, frame: { type: 'signal', from: cid(1), session: SESSION, purpose: 'link', relay: false, data: SDP } },
    ]);
  });

  it('answers peer_offline with the session when the machine is offline', () => {
    const { effects } = clientSignal(cid(1), env(2), { online: new Set([env(1)]) });
    expect(sends(effects)).toEqual([
      { kind: 'send', to: 'self', frame: { type: 'error', code: 'peer_offline', message: 'the machine is offline', session: SESSION } },
    ]);
  });

  it('refuses a phone signalling another phone or itself', () => {
    for (const to of [cid(2), cid(1)]) {
      const { effects } = clientSignal(cid(1), to, { online: new Set([env(1)]), onlineClients: new Set([cid(2)]) });
      expect(sends(effects)).toEqual([
        { kind: 'send', to: 'self', frame: { type: 'error', code: 'bad_frame', message: 'a phone cannot signal a phone', session: SESSION } },
      ]);
    }
  });

  it('forwards a machine link signal to an online phone with from = the environment id', () => {
    const { effects } = machineSignal(env(1), cid(1), 'link', { online: new Set([env(2)]), onlineClients: new Set([cid(1)]) });
    expect(sends(effects)).toEqual([
      { kind: 'send', to: { clientId: cid(1) }, frame: { type: 'signal', from: env(1), session: SESSION, purpose: 'link', relay: true, data: SDP } },
    ]);
    expect(logs(effects)).toContainEqual(expect.objectContaining({ outcome: 'forwarded_client' }));
  });

  it('answers peer_offline to a machine signalling an offline phone', () => {
    const { effects } = machineSignal(env(1), cid(1), 'link');
    expect(sends(effects)).toEqual([
      { kind: 'send', to: 'self', frame: { type: 'error', code: 'peer_offline', message: 'the other machine is offline', session: SESSION } },
    ]);
  });

  it('never routes a machine approval signal to a phone', () => {
    const { effects } = machineSignal(env(1), cid(1), 'approval', { onlineClients: new Set([cid(1)]) });
    expect(sends(effects)).toEqual([
      {
        kind: 'send',
        to: 'self',
        frame: { type: 'error', code: 'approval_unknown', message: 'no pending approval between these machines', session: SESSION },
      },
    ]);
  });

  it('answers phone ice-servers with the machine rules', () => {
    const iceServers = (state: DirectoryState, relay: boolean, over: Partial<ReduceContext> = {}) =>
      reduceClient(state, { kind: 'client-frame', clientId: cid(1), frame: { type: 'ice-servers', requestId: 'r-1', relay } }, ctx(over)).effects;

    const free = phones(machines(1), 1);
    expect(sends(iceServers(free, false, { stunUrls: ['stun:s:1'] }))).toEqual([
      { kind: 'send', to: 'self', frame: { type: 'ice-servers', requestId: 'r-1', iceServers: [{ urls: ['stun:s:1'] }] } },
    ]);
    expect(sends(iceServers(free, true))).toEqual([
      { kind: 'send', to: 'self', frame: { type: 'error', code: 'relay_not_allowed', message: 'the relay needs the relay plan', requestId: 'r-1' } },
    ]);
    const tester = phones(machines(1, TESTER), 1, TESTER);
    const turn = iceServers(tester, true, { turnConfigured: true });
    expect(turn).toContainEqual({ kind: 'fetch-turn', requestId: 'r-1' });
    expect(logs(turn)).toEqual([{ kind: 'log', type: 'ice-servers', environmentId: null, clientId: cid(1), outcome: 'turn' }]);
  });

  it('meters phone relay usage against the account and tells machines and phones', () => {
    const state = phones(machines(1, TESTER), 1, TESTER);
    const { state: next, effects } = reduceClient(state, { kind: 'client-frame', clientId: cid(1), frame: { type: 'relay-usage', bytes: 500 } }, ctx());
    expect(next.relay?.bytes).toBe(500);
    expect(effects).toContainEqual({ kind: 'put-relay-usage', usage: expect.objectContaining({ bytes: 500 }) });
    const targets = sends(effects).map((e) => [e.to, e.frame.type]);
    expect(targets).toEqual([
      ['all', 'relay-status'],
      ['clients', 'relay-status'],
    ]);
  });
});

describe('directory reducer: machine changes reach phones (PAN-4829 WI-5)', () => {
  const withPhone = () => phones(machines(3), 1);
  const toClients = (effects: DirectoryEffect[]) => sends(effects).filter((e) => e.to === 'clients' || (typeof e.to === 'object' && 'clientId' in e.to));
  const machineFrames = (effects: DirectoryEffect[]) =>
    sends(effects).filter((e) => e.frame.type === 'welcome' || (e.frame.type === 'directory' && e.to !== 'clients'));

  function expectOneDirectoryToClients(effects: DirectoryEffect[]) {
    const out = toClients(effects);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ to: 'clients', frame: { type: 'directory' } });
    const others = sends(effects).find((e) => e.to === 'others' && e.frame.type === 'directory');
    expect(out[0]?.frame).toEqual(others?.frame);
  }

  function expectNoClientIn(effects: DirectoryEffect[]) {
    const text = JSON.stringify(machineFrames(effects));
    expect(text).not.toContain(cid(1));
    expect(text).not.toContain(LABEL_MARKER);
  }

  it('sends one directory frame to phones on a new and an updated machine hello', () => {
    for (const n of [4, 2]) {
      const { effects } = reduce(withPhone(), { kind: 'hello', registeredAs: null, identity: TESTER, frame: machineHello(n), fingerprint: `fp-${n}` }, ctx());
      expectOneDirectoryToClients(effects);
      expectNoClientIn(effects);
    }
  });

  it('sends one directory frame to phones on endpoints, forget and socket-gone', () => {
    const endpoints = reduce(withPhone(), { kind: 'frame', registeredAs: env(1), frame: { type: 'endpoints', endpoints: [] } }, ctx());
    expectOneDirectoryToClients(endpoints.effects);
    expectNoClientIn(endpoints.effects);

    const forget = reduce(withPhone(), { kind: 'frame', registeredAs: env(1), frame: { type: 'forget', environmentId: env(3) } }, ctx());
    expectOneDirectoryToClients(forget.effects);
    expectNoClientIn(forget.effects);

    const gone = reduce(withPhone(), { kind: 'socket-gone', registeredAs: env(2) }, ctx());
    expectOneDirectoryToClients(gone.effects);
  });

  it('never sends approvals to phones', () => {
    const request = reduce(
      withPhone(),
      { kind: 'frame', registeredAs: env(1), frame: { type: 'approval-request', requestId: 'd'.repeat(32), to: null } },
      ctx({ onlineClients: new Set([cid(1)]) }),
    );
    expect(sends(request.effects).some((e) => e.frame.type === 'approval-request')).toBe(true);
    expect(toClients(request.effects)).toEqual([]);

    const cancel = reduce(
      request.state,
      { kind: 'frame', registeredAs: env(1), frame: { type: 'approval-cancel', requestId: 'd'.repeat(32) } },
      ctx({ onlineClients: new Set([cid(1)]) }),
    );
    expect(sends(cancel.effects).some((e) => e.frame.type === 'approval-cancel')).toBe(true);
    expect(toClients(cancel.effects)).toEqual([]);
  });
});

const PUSH_TOKEN = 'f0'.repeat(32);
type PushFrame = Extract<ClientToDirectoryFrame, { type: 'push-register' | 'push-unregister' }>;

function pushFrame(state: DirectoryState, clientId: string, frame: PushFrame) {
  return reduceClient(state, { kind: 'client-frame', clientId, frame }, ctx());
}

function androidPhone(state: DirectoryState, n: number): DirectoryState {
  const frame = { ...helloClientFrame(n), platform: 'android' as const };
  return reduceClient(state, { kind: 'hello-client', registeredAs: null, identity: FREE, frame }, ctx()).state;
}

const pushOf = (state: DirectoryState, clientId: string) => state.clients.find((c) => c.clientId === clientId)?.push;

describe('client reducer: push registration (PAN-4830 WI-8)', () => {
  it('stores an iOS registration as production when apsEnvironment is absent', () => {
    const { state, effects } = pushFrame(phones(EMPTY_DIRECTORY, 1), cid(1), { type: 'push-register', platform: 'ios', token: PUSH_TOKEN });
    const registration = { platform: 'ios', token: PUSH_TOKEN, apsEnvironment: 'production' };
    expect(pushOf(state, cid(1))).toEqual(registration);
    expect(effects).toEqual([
      { kind: 'put-client-push', clientId: cid(1), registration },
      { kind: 'log', type: 'push-register', environmentId: null, outcome: 'registered', clientId: cid(1) },
    ]);
  });

  it('keeps a sandbox apsEnvironment and stores null for Android', () => {
    const ios = pushFrame(phones(EMPTY_DIRECTORY, 1), cid(1), { type: 'push-register', platform: 'ios', token: PUSH_TOKEN, apsEnvironment: 'sandbox' });
    expect(pushOf(ios.state, cid(1))).toEqual({ platform: 'ios', token: PUSH_TOKEN, apsEnvironment: 'sandbox' });
    const android = pushFrame(androidPhone(EMPTY_DIRECTORY, 2), cid(2), { type: 'push-register', platform: 'android', token: 'fcm:token' });
    expect(pushOf(android.state, cid(2))).toEqual({ platform: 'android', token: 'fcm:token', apsEnvironment: null });
    expect(android.effects).toContainEqual({ kind: 'put-client-push', clientId: cid(2), registration: { platform: 'android', token: 'fcm:token', apsEnvironment: null } });
  });

  it('refuses a register whose platform differs from the phone, and stores nothing', () => {
    const before = phones(EMPTY_DIRECTORY, 1);
    const { state, effects } = pushFrame(before, cid(1), { type: 'push-register', platform: 'android', token: PUSH_TOKEN });
    expect(state).toBe(before);
    expect(effects).toEqual([
      { kind: 'send', to: 'self', frame: { type: 'error', code: 'bad_frame', message: 'push platform does not match the phone' } },
      { kind: 'log', type: 'push-register', environmentId: null, outcome: 'platform_mismatch', clientId: cid(1) },
    ]);
  });

  it('clears the registration on push-unregister', () => {
    const registered = pushFrame(phones(EMPTY_DIRECTORY, 1), cid(1), { type: 'push-register', platform: 'ios', token: PUSH_TOKEN }).state;
    const { state, effects } = pushFrame(registered, cid(1), { type: 'push-unregister' });
    expect(pushOf(state, cid(1))).toBeNull();
    expect(effects).toEqual([
      { kind: 'put-client-push', clientId: cid(1), registration: null },
      { kind: 'log', type: 'push-unregister', environmentId: null, outcome: 'unregistered', clientId: cid(1) },
    ]);
  });

  it('keeps the registration through a second hello-client and emits no put-client-push', () => {
    const registered = pushFrame(phones(EMPTY_DIRECTORY, 1), cid(1), { type: 'push-register', platform: 'ios', token: PUSH_TOKEN }).state;
    const { state, effects } = helloClient(registered, 1);
    expect(pushOf(state, cid(1))).toEqual({ platform: 'ios', token: PUSH_TOKEN, apsEnvironment: 'production' });
    expect(effects.some((e) => e.kind === 'put-client-push')).toBe(false);
    expect(effects.find((e) => e.kind === 'put-client')).toMatchObject({ row: { push: { token: PUSH_TOKEN } } });
  });

  it('starts a new phone with no registration', () => {
    expect(pushOf(phones(EMPTY_DIRECTORY, 1), cid(1))).toBeNull();
  });

  it('answers a frame from a phone with no row without changing state', () => {
    const { state, effects } = pushFrame(EMPTY_DIRECTORY, cid(9), { type: 'push-register', platform: 'ios', token: PUSH_TOKEN });
    expect(state).toBe(EMPTY_DIRECTORY);
    expect(effects).toEqual([{ kind: 'log', type: 'push-register', environmentId: null, outcome: 'unknown_client', clientId: cid(9) }]);
  });

  it('never logs the push token', () => {
    let state = phones(EMPTY_DIRECTORY, 1);
    const all: DirectoryEffect[] = [];
    for (const frame of [
      { type: 'push-register', platform: 'ios', token: PUSH_TOKEN },
      { type: 'push-register', platform: 'android', token: PUSH_TOKEN },
      { type: 'push-unregister' },
    ] as const) {
      const result = pushFrame(state, cid(1), frame);
      state = result.state;
      all.push(...result.effects);
    }
    expect(logs(all)).toHaveLength(3);
    expect(JSON.stringify(logs(all))).not.toContain(PUSH_TOKEN);
  });
});
