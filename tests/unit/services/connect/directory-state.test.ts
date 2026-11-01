import { describe, expect, it } from 'vitest';
import { FREE_MACHINE_LIMIT_MESSAGE } from '../../../../packages/contracts/src/connect.ts';
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
    { now: NOW, online: new Set(online) },
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
      { now: NOW, online: new Set([env(3)]) },
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
    const { state: next, effects } = reduce(state, { kind: 'socket-gone', registeredAs: env(2) }, { now: later, online: new Set([env(1)]) });
    expect(next.machines[1]?.lastSeenAt).toBe(later);
    const frame = sends(effects)[0];
    expect(frame).toMatchObject({ to: 'others', frame: { type: 'directory' } });
    const machines = (frame as { frame: { machines: Array<{ online: boolean; lastSeenAt: string }> } }).frame.machines;
    expect(machines.map((m) => m.online)).toEqual([true, false]);
    expect(machines[1]?.lastSeenAt).toBe(new Date(later).toISOString());
  });

  it('closes a socket that sends another frame before hello with 4010', () => {
    const { effects } = reduce(EMPTY_DIRECTORY, { kind: 'frame', registeredAs: null, frame: { type: 'endpoints', endpoints: [] } }, { now: NOW, online: new Set() });
    expect(closes(effects)).toEqual([{ kind: 'close', to: 'self', code: 4010, reason: 'hello required' }]);
  });

  it('answers an unsupported protocol with an error and close 4010', () => {
    const { effects } = reduce(EMPTY_DIRECTORY, { kind: 'bad-frame', registeredAs: null, reason: 'unsupported' }, { now: NOW, online: new Set() });
    expect(sends(effects)[0]).toMatchObject({ frame: { type: 'error', code: 'unsupported' } });
    expect(closes(effects)[0]).toMatchObject({ code: 4010 });
  });

  it('logs only frame types, ids and outcomes', () => {
    const { effects } = reduce(
      EMPTY_DIRECTORY,
      { kind: 'hello', registeredAs: null, identity: FREE, frame: helloFrame(1, 'SECRET-LABEL'), fingerprint: 'fp' },
      { now: NOW, online: new Set() },
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
