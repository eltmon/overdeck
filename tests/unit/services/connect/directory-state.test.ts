import { describe, expect, it } from 'vitest';
import { FREE_MACHINE_LIMIT_MESSAGE, RELAY_CAP_MESSAGE, RELAY_MONTHLY_CAP_BYTES } from '../../../../packages/contracts/src/connect.ts';
import type { MachineToDirectoryFrame } from '../../../../packages/contracts/src/connect.ts';
import { EMPTY_DIRECTORY, reduce } from '../../../../services/connect/src/directory-state.ts';
import type { DirectoryEffect, DirectoryState, SocketIdentity } from '../../../../services/connect/src/directory-state.ts';
import { keyFingerprint } from '../../../../services/connect/src/fingerprint.ts';
import { decodeMachineFrame } from '../../../../services/connect/src/protocol.ts';
import { machineKeyFingerprint } from '../../../../src/lib/anywhere/machine-key.ts';

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const FREE: SocketIdentity = { deviceId: 'd-1', plan: 'free', maxDevices: 3 };
const TESTER: SocketIdentity = { deviceId: 'd-1', plan: 'tester', maxDevices: null };
const env = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const key = (n: number) => n.toString(16).padStart(2, '0').repeat(32);

function helloFrame(n: number, label = `machine-${n}`): Extract<MachineToDirectoryFrame, { type: 'hello' }> {
  return {
    type: 'hello',
    protocol: 1,
    environmentId: env(n),
    label,
    publicKeyHex: key(n),
    serverVersion: '0.72.0',
    linkProtocol: 1,
    endpoints: [{ kind: 'lan', url: `tcp://192.168.1.${n}:3011` }],
  };
}

function hello(state: DirectoryState, n: number, identity = FREE, online: string[] = []) {
  return reduce(
    state,
    { kind: 'hello', registeredAs: null, identity, frame: helloFrame(n), fingerprint: `fp-${n}` },
    { now: NOW, online: new Set(online), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false },
  );
}

function register(count: number, identity = FREE): DirectoryState {
  let state = EMPTY_DIRECTORY;
  for (let n = 1; n <= count; n++) state = hello(state, n, identity).state;
  return state;
}

const sends = (effects: DirectoryEffect[]) => effects.filter((e) => e.kind === 'send');
const closes = (effects: DirectoryEffect[]) => effects.filter((e) => e.kind === 'close');

describe('directory reducer: presence and the machine limit (PAN-2356 WI-5)', () => {
  it('refuses a fourth machine on the free plan with the exact message and close 4009', () => {
    const state = register(3);
    const { state: next, effects } = hello(state, 4);
    expect(next.machines).toHaveLength(3);
    expect(sends(effects)).toEqual([
      { kind: 'send', to: 'self', frame: { type: 'error', code: 'machine_limit', message: FREE_MACHINE_LIMIT_MESSAGE } },
    ]);
    expect(closes(effects)).toEqual([{ kind: 'close', to: 'self', code: 4009, reason: 'machine limit' }]);
    expect(effects.some((e) => e.kind === 'register' || e.kind === 'put-machine')).toBe(false);
  });

  it('lets a known machine re-register on a full free account', () => {
    const state = register(3);
    const { state: next, effects } = hello(state, 2);
    expect(next.machines).toHaveLength(3);
    expect(effects).toContainEqual({ kind: 'register', environmentId: env(2) });
    expect(sends(effects)[0]).toMatchObject({ to: 'self', frame: { type: 'welcome', plan: 'free', maxMachines: 3, relayAllowed: false } });
  });

  it('frees a slot when a machine is forgotten', () => {
    const state = register(3);
    const forgotten = reduce(
      state,
      { kind: 'frame', registeredAs: env(1), frame: { type: 'forget', environmentId: env(3) } },
      { now: NOW, online: new Set([env(3)]), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false },
    );
    expect(forgotten.state.machines.map((m) => m.environmentId)).toEqual([env(1), env(2)]);
    expect(forgotten.effects).toContainEqual({ kind: 'delete-machine', environmentId: env(3) });
    expect(forgotten.effects).toContainEqual({ kind: 'close', to: { environmentId: env(3) }, code: 4012, reason: 'forgotten' });
    expect(hello(forgotten.state, 4).state.machines).toHaveLength(3);
  });

  it('has no machine limit on the tester plan', () => {
    const state = register(5, TESTER);
    expect(state.machines).toHaveLength(5);
    const { effects } = hello(state, 6, TESTER);
    expect(sends(effects)[0]).toMatchObject({ frame: { type: 'welcome', plan: 'tester', maxMachines: null, relayAllowed: true, inboxAllowed: true } });
  });

  it('closes an older socket of the same machine with 4011 and announces the directory to the others', () => {
    const state = register(2);
    const { effects } = hello(state, 2, FREE, [env(1), env(2)]);
    expect(effects).toContainEqual({ kind: 'close', to: { environmentId: env(2) }, code: 4011, reason: 'replaced' });
    const directory = sends(effects).find((e) => e.kind === 'send' && e.to === 'others');
    expect(directory).toMatchObject({ frame: { type: 'directory' } });
  });

  it('marks a machine offline with a new last-seen time when its last socket goes', () => {
    const state = register(2);
    const later = NOW + 60_000;
    const { state: next, effects } = reduce(state, { kind: 'socket-gone', registeredAs: env(2) }, { now: later, online: new Set([env(1)]), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false });
    expect(next.machines[1]?.lastSeenAt).toBe(later);
    const frame = sends(effects)[0];
    expect(frame).toMatchObject({ to: 'others', frame: { type: 'directory' } });
    const machines = (frame as { frame: { machines: Array<{ online: boolean; lastSeenAt: string }> } }).frame.machines;
    expect(machines.map((m) => m.online)).toEqual([true, false]);
    expect(machines[1]?.lastSeenAt).toBe(new Date(later).toISOString());
  });

  it('closes a socket that sends another frame before hello with 4010', () => {
    const { effects } = reduce(EMPTY_DIRECTORY, { kind: 'frame', registeredAs: null, frame: { type: 'endpoints', endpoints: [] } }, { now: NOW, online: new Set(), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false });
    expect(closes(effects)).toEqual([{ kind: 'close', to: 'self', code: 4010, reason: 'hello required' }]);
  });

  it('answers an unsupported protocol with an error and close 4010', () => {
    const { effects } = reduce(EMPTY_DIRECTORY, { kind: 'bad-frame', registeredAs: null, reason: 'unsupported' }, { now: NOW, online: new Set(), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false });
    expect(sends(effects)[0]).toMatchObject({ frame: { type: 'error', code: 'unsupported' } });
    expect(closes(effects)[0]).toMatchObject({ code: 4010 });
  });

  it('logs only frame types, ids and outcomes', () => {
    const { effects } = reduce(
      EMPTY_DIRECTORY,
      { kind: 'hello', registeredAs: null, identity: FREE, frame: helloFrame(1, 'SECRET-LABEL'), fingerprint: 'fp' },
      { now: NOW, online: new Set(), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false },
    );
    const logs = effects.filter((e) => e.kind === 'log');
    expect(logs).toEqual([{ kind: 'log', type: 'hello', environmentId: env(1), outcome: 'registered' }]);
  });
});

describe('directory protocol decoding', () => {
  it('rebuilds hello from known keys only', () => {
    const decoded = decodeMachineFrame(JSON.stringify({ ...helloFrame(1), extra: 'dropped' }));
    expect(decoded).toEqual({ ok: true, frame: helloFrame(1) });
  });

  it('rejects labels over 64 chars, more than 16 endpoints and frames over 64 KiB', () => {
    expect(decodeMachineFrame(JSON.stringify({ ...helloFrame(1), label: 'x'.repeat(65) }))).toEqual({ ok: false, reason: 'bad_frame' });
    const endpoints = Array.from({ length: 17 }, (_, i) => ({ kind: 'lan', url: `tcp://10.0.0.${i}:3011` }));
    expect(decodeMachineFrame(JSON.stringify({ ...helloFrame(1), endpoints }))).toEqual({ ok: false, reason: 'bad_frame' });
    expect(decodeMachineFrame(JSON.stringify({ type: 'forget', environmentId: env(1), pad: 'x'.repeat(65_536) }))).toEqual({ ok: false, reason: 'bad_frame' });
    expect(decodeMachineFrame(new ArrayBuffer(4))).toEqual({ ok: false, reason: 'bad_frame' });
  });

  it('reports another protocol version as unsupported', () => {
    expect(decodeMachineFrame(JSON.stringify({ ...helloFrame(1), protocol: 2 }))).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('rejects an environment id that is not a lowercase UUID v4', () => {
    expect(decodeMachineFrame(JSON.stringify({ type: 'forget', environmentId: 'not-a-uuid' }))).toEqual({ ok: false, reason: 'bad_frame' });
  });
});

describe('keyFingerprint', () => {
  it('matches machineKeyFingerprint on the machine', async () => {
    const hex = 'a1b2c3d4'.repeat(8);
    expect(await keyFingerprint(hex)).toBe(machineKeyFingerprint(hex));
  });
});

describe('directory reducer: signalling and approvals (PAN-2356 WI-6)', () => {
  const ctx = (online: string[], now = NOW) => ({ now, online: new Set(online), stunUrls: ['stun:stun.cloudflare.com:3478'], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false });
  const id = (n: number) => n.toString(16).padStart(32, '0');
  const offer = { sdp: { type: 'offer' as const, sdp: 'v=0' } };

  it('forwards a signal with from stamped as the sender', () => {
    const state = register(2, TESTER);
    const { effects } = reduce(
      state,
      { kind: 'frame', registeredAs: env(1), frame: { type: 'signal', to: env(2), session: id(1), purpose: 'link', relay: false, data: offer } },
      ctx([env(2)]),
    );
    expect(sends(effects)).toEqual([
      { kind: 'send', to: { environmentId: env(2) }, frame: { type: 'signal', from: env(1), session: id(1), purpose: 'link', relay: false, data: offer } },
    ]);
  });

  it('answers peer_offline with the session when the target has no socket', () => {
    const state = register(2, TESTER);
    const { effects } = reduce(
      state,
      { kind: 'frame', registeredAs: env(1), frame: { type: 'signal', to: env(2), session: id(7), purpose: 'link', relay: false, data: offer } },
      ctx([]),
    );
    expect(sends(effects)[0]).toMatchObject({ to: 'self', frame: { type: 'error', code: 'peer_offline', session: id(7) } });
  });

  it('refuses an approval signal with no pending approval as approval_unknown', () => {
    const state = register(2, TESTER);
    const { effects } = reduce(
      state,
      { kind: 'frame', registeredAs: env(1), frame: { type: 'signal', to: env(2), session: id(1), purpose: 'approval', relay: false, data: offer } },
      ctx([env(2)]),
    );
    expect(sends(effects)[0]).toMatchObject({ to: 'self', frame: { type: 'error', code: 'approval_unknown', session: id(1) } });
  });

  it('passes approval signals both ways while a request is pending, and stores and forwards the request', () => {
    const state = register(2, TESTER);
    const requested = reduce(state, { kind: 'frame', registeredAs: env(2), frame: { type: 'approval-request', requestId: id(9), to: null } }, ctx([env(1)]));
    expect(requested.effects).toContainEqual({
      kind: 'send',
      to: 'others',
      frame: { type: 'approval-request', requestId: id(9), from: env(2), label: 'machine-2', fingerprint: 'fp-2', publicKeyHex: key(2), expiresAt: NOW + 600_000 },
    });
    const back = reduce(
      requested.state,
      { kind: 'frame', registeredAs: env(1), frame: { type: 'signal', to: env(2), session: id(1), purpose: 'approval', relay: false, data: offer } },
      ctx([env(2)]),
    );
    expect(sends(back.effects)[0]).toMatchObject({ to: { environmentId: env(2) }, frame: { type: 'signal', from: env(1), purpose: 'approval' } });
  });

  it('refuses a sixth pending approval in an account with approval_limit', () => {
    let state = register(6, TESTER);
    for (let n = 1; n <= 5; n++) {
      state = reduce(state, { kind: 'frame', registeredAs: env(n), frame: { type: 'approval-request', requestId: id(n), to: null } }, ctx([])).state;
    }
    expect(state.approvals).toHaveLength(5);
    const sixth = reduce(state, { kind: 'frame', registeredAs: env(6), frame: { type: 'approval-request', requestId: id(6), to: null } }, ctx([]));
    expect(sixth.state.approvals).toHaveLength(5);
    expect(sends(sixth.effects)[0]).toMatchObject({ to: 'self', frame: { type: 'error', code: 'approval_limit', requestId: id(6) } });
  });

  it('keeps one pending request per requesting machine', () => {
    const state = register(2, TESTER);
    const first = reduce(state, { kind: 'frame', registeredAs: env(1), frame: { type: 'approval-request', requestId: id(1), to: env(2) } }, ctx([]));
    const second = reduce(first.state, { kind: 'frame', registeredAs: env(1), frame: { type: 'approval-request', requestId: id(2), to: env(2) } }, ctx([]));
    expect(sends(second.effects)[0]).toMatchObject({ frame: { code: 'approval_limit' } });
  });

  it('drops an expired request after 10 minutes', () => {
    const state = register(2, TESTER);
    const requested = reduce(state, { kind: 'frame', registeredAs: env(1), frame: { type: 'approval-request', requestId: id(1), to: env(2) } }, ctx([]));
    const later = reduce(
      requested.state,
      { kind: 'frame', registeredAs: env(2), frame: { type: 'signal', to: env(1), session: id(3), purpose: 'approval', relay: false, data: offer } },
      ctx([env(1)], NOW + 600_000),
    );
    expect(later.state.approvals).toEqual([]);
    expect(later.effects[0]).toEqual({ kind: 'delete-approval', requestId: id(1) });
    expect(sends(later.effects)[0]).toMatchObject({ frame: { code: 'approval_unknown' } });
  });

  it('sends pending approvals to a target machine on its welcome', () => {
    const state = register(2, TESTER);
    const requested = reduce(state, { kind: 'frame', registeredAs: env(1), frame: { type: 'approval-request', requestId: id(1), to: env(2) } }, ctx([]));
    const { effects } = hello(requested.state, 2, TESTER, [env(1)]);
    const frames = sends(effects).filter((e) => e.kind === 'send' && e.to === 'self').map((e) => (e as { frame: { type: string } }).frame.type);
    expect(frames).toEqual(['welcome', 'approval-request']);
  });

  it('cancels a request and tells the other machines', () => {
    const state = register(2, TESTER);
    const requested = reduce(state, { kind: 'frame', registeredAs: env(1), frame: { type: 'approval-request', requestId: id(1), to: env(2) } }, ctx([]));
    const cancelled = reduce(requested.state, { kind: 'frame', registeredAs: env(2), frame: { type: 'approval-cancel', requestId: id(1) } }, ctx([env(1)]));
    expect(cancelled.state.approvals).toEqual([]);
    expect(cancelled.effects).toContainEqual({ kind: 'send', to: 'others', frame: { type: 'approval-cancel', requestId: id(1) } });
  });

  it('answers ice-servers relay false with the STUN servers', () => {
    const state = register(1, TESTER);
    const { effects } = reduce(state, { kind: 'frame', registeredAs: env(1), frame: { type: 'ice-servers', requestId: 'r1', relay: false } }, ctx([]));
    expect(sends(effects)[0]).toEqual({
      kind: 'send',
      to: 'self',
      frame: { type: 'ice-servers', requestId: 'r1', iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] },
    });
  });
});

describe('directory reducer: relay credentials and metering (PAN-2356 WI-7)', () => {
  const CAP = 1_000;
  const ctx = (now = NOW, turnConfigured = true) => ({ now, online: new Set<string>(), stunUrls: [], relayCapBytes: CAP, turnConfigured });
  const ask = (state: DirectoryState, now = NOW, turnConfigured = true) =>
    reduce(state, { kind: 'frame', registeredAs: env(1), frame: { type: 'ice-servers', requestId: 'r', relay: true } }, ctx(now, turnConfigured));
  const report = (state: DirectoryState, bytes: number, now = NOW) =>
    reduce(state, { kind: 'frame', registeredAs: env(1), frame: { type: 'relay-usage', bytes } }, ctx(now));

  it('refuses a free plan with relay_not_allowed', () => {
    const { effects } = ask(register(1, FREE));
    expect(sends(effects)[0]).toMatchObject({ frame: { type: 'error', code: 'relay_not_allowed', requestId: 'r' } });
  });

  it('mints TURN credentials for a tester account under the cap', () => {
    const { effects } = ask(register(1, TESTER));
    expect(effects).toContainEqual({ kind: 'fetch-turn', requestId: 'r' });
  });

  it('refuses with turn_unavailable when the TURN secrets are unset', () => {
    const { effects } = ask(register(1, TESTER), NOW, false);
    expect(sends(effects)[0]).toMatchObject({ frame: { code: 'turn_unavailable' } });
  });

  it('broadcasts the month total after each report and stopped once at the cap, then refuses with relay_cap_reached', () => {
    let state = register(1, TESTER);
    const first = report(state, 600);
    expect(sends(first.effects)).toEqual([
      { kind: 'send', to: 'all', frame: { type: 'relay-status', month: '2026-11', bytesUsed: 600, capBytes: CAP, stopped: false } },
      // Phones see the same status (PAN-4829 FR-8).
      { kind: 'send', to: 'clients', frame: { type: 'relay-status', month: '2026-11', bytesUsed: 600, capBytes: CAP, stopped: false } },
    ]);
    state = first.state;
    const second = report(state, 500);
    expect(sends(second.effects)).toEqual([
      { kind: 'send', to: 'all', frame: { type: 'relay-status', month: '2026-11', bytesUsed: 1_100, capBytes: CAP, stopped: true } },
      // Phones see the same status (PAN-4829 FR-8).
      { kind: 'send', to: 'clients', frame: { type: 'relay-status', month: '2026-11', bytesUsed: 1_100, capBytes: CAP, stopped: true } },
    ]);
    const third = report(second.state, 10);
    expect(sends(third.effects)).toEqual([]);
    const refused = ask(third.state);
    expect(sends(refused.effects)[0]).toMatchObject({ frame: { code: 'relay_cap_reached', message: RELAY_CAP_MESSAGE } });
  });

  it('starts a fresh allowance on 1 December UTC', () => {
    const capped = report(register(1, TESTER), 2_000).state;
    const december = Date.UTC(2026, 11, 1, 0, 0, 0);
    expect(ask(capped, december).effects).toContainEqual({ kind: 'fetch-turn', requestId: 'r' });
    const welcome = reduce(capped, { kind: 'hello', registeredAs: null, identity: TESTER, frame: helloFrame(1), fingerprint: 'fp-1' }, ctx());
    expect(sends(welcome.effects)[0]).toMatchObject({ frame: { relay: { month: '2026-11', bytesUsed: 2_000, capBytes: CAP, stopped: true } } });
    const decemberWelcome = reduce(capped, { kind: 'hello', registeredAs: null, identity: TESTER, frame: helloFrame(1), fingerprint: 'fp-1' }, ctx(december));
    expect(sends(decemberWelcome.effects)[0]).toMatchObject({ frame: { relay: { month: '2026-12', bytesUsed: 0, stopped: false } } });
  });
});

describe('directory reducer: push (PAN-4830)', () => {
  it('answers a push to a phone the account does not have with unknown_client and keeps state', () => {
    const state = register(1);
    const result = reduce(
      state,
      {
        kind: 'frame',
        registeredAs: env(1),
        frame: {
          type: 'push',
          requestId: '0'.repeat(32),
          to: '00000000-0000-4000-8000-0000000000aa',
          sealed: 'AAAA',
          urgency: 'high',
          collapseId: '1'.repeat(32),
        },
      },
      { now: NOW, online: new Set(), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false },
    );
    expect(result.state).toBe(state);
    expect(sends(result.effects)).toEqual([
      { kind: 'send', to: 'self', frame: { type: 'push-result', requestId: '0'.repeat(32), ok: false, error: 'unknown_client' } },
    ]);
    expect(closes(result.effects)).toEqual([]);
    expect(result.effects.some((e) => e.kind === 'deliver-push')).toBe(false);
    expect(result.effects).toContainEqual({
      kind: 'log',
      type: 'push',
      environmentId: env(1),
      outcome: 'unknown_client',
      clientId: '00000000-0000-4000-8000-0000000000aa',
    });
  });

  it('decodes a valid push', () => {
    const frame = {
      type: 'push',
      requestId: '0'.repeat(32),
      to: env(2),
      sealed: 'AAAA',
      urgency: 'high',
      collapseId: '1'.repeat(32),
    } as const;
    expect(decodeMachineFrame(JSON.stringify(frame))).toEqual({ ok: true, frame });
  });
});

describe('directory reducer: the account page removes a machine (PAN-4959 WI-2)', () => {
  const CTX = { now: NOW, online: new Set([env(1), env(2), env(3)]), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false };

  it('removes a known machine, tells every other machine and phone, closes it 4012 and sends nothing to self', () => {
    const approval = { requestId: 'r-1', fromEnv: env(1), toEnv: env(2), createdAt: NOW, expiresAt: NOW + 60_000 };
    const state: DirectoryState = { ...register(3), approvals: [approval] };
    const { state: next, effects } = reduce(state, { kind: 'remove-machine', environmentId: env(1) }, CTX);
    expect(next.machines.map((m) => m.environmentId)).toEqual([env(2), env(3)]);
    expect(next.approvals).toEqual([]);
    expect(effects).toContainEqual({ kind: 'delete-machine', environmentId: env(1) });
    expect(effects).toContainEqual({ kind: 'delete-approval', requestId: 'r-1' });
    expect(effects).toContainEqual({ kind: 'inbox-forget', environmentId: env(1) });
    for (const to of ['others', 'clients'] as const) {
      const directory = sends(effects).find((e) => e.kind === 'send' && e.to === to) as { frame: { type: string; machines: Array<{ environmentId: string; online: boolean }> } };
      expect(directory.frame.type).toBe('directory');
      expect(directory.frame.machines.map((m) => [m.environmentId, m.online])).toEqual([[env(2), true], [env(3), true]]);
    }
    expect(closes(effects)).toEqual([{ kind: 'close', to: { environmentId: env(1) }, code: 4012, reason: 'forgotten' }]);
    expect(effects.some((e) => (e.kind === 'send' || e.kind === 'close') && (e.to === 'self' || e.to === 'all'))).toBe(false);
    expect(effects).toContainEqual({ kind: 'log', type: 'remove-machine', environmentId: env(1), outcome: 'ok' });
    expect(hello(next, 4).state.machines).toHaveLength(3);
  });

  it('leaves the state unchanged with only a log for an unknown machine', () => {
    const state = register(2);
    const { state: next, effects } = reduce(state, { kind: 'remove-machine', environmentId: env(9) }, CTX);
    expect(next).toBe(state);
    expect(effects).toEqual([{ kind: 'log', type: 'remove-machine', environmentId: env(9), outcome: 'unknown_machine' }]);
  });
});
