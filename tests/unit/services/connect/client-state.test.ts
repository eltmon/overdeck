import { describe, expect, it } from 'vitest';
import { CLIENT_LIMIT_MESSAGE, RELAY_MONTHLY_CAP_BYTES } from '../../../../packages/contracts/src/connect.ts';
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
