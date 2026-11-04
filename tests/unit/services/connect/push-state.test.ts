import { describe, expect, it } from 'vitest';
import { PUSH_RATE_PER_MINUTE, RELAY_MONTHLY_CAP_BYTES } from '../../../../packages/contracts/src/connect.ts';
import type { MachineToDirectoryFrame } from '../../../../packages/contracts/src/connect.ts';
import { reduceClient } from '../../../../services/connect/src/client-state.ts';
import { EMPTY_DIRECTORY, reduce } from '../../../../services/connect/src/directory-state.ts';
import type { DirectoryEffect, DirectoryState, ReduceContext, SocketIdentity } from '../../../../services/connect/src/directory-state.ts';
import { reducePushOutcome } from '../../../../services/connect/src/push-state.ts';
import type { PushOutcome } from '../../../../services/connect/src/push/config.ts';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const MINUTE = Math.floor(NOW / 60_000);
const FREE: SocketIdentity = { deviceId: 'd-1', plan: 'free', maxDevices: 3 };
const ENV = '00000000-0000-4000-8000-000000000001';
const PHONE = '00000000-0000-4000-9000-000000000001';
const BARE_PHONE = '00000000-0000-4000-9000-000000000002';
const STRANGER = '00000000-0000-4000-9000-0000000000ff';
const TOKEN = 'f0'.repeat(32);
const SEALED = 'U0VBTEVELU1BUktFUg==';
const COLLAPSE = 'c'.repeat(32);

function ctx(over: Partial<ReduceContext> = {}): ReduceContext {
  return { now: NOW, online: new Set(), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false, ...over };
}

function phoneHello(state: DirectoryState, clientId: string): DirectoryState {
  const frame = { type: 'hello-client', protocol: 1, clientId, label: 'phone', publicKeyHex: 'ab'.repeat(32), appVersion: '1.0.0', platform: 'ios' } as const;
  return reduceClient(state, { kind: 'hello-client', registeredAs: null, identity: FREE, frame }, ctx()).state;
}

/** One machine, one iOS phone registered for push, and one phone without a registration. */
function account(): DirectoryState {
  const hello = {
    type: 'hello',
    protocol: 1,
    environmentId: ENV,
    label: 'machine-1',
    publicKeyHex: '01'.repeat(32),
    serverVersion: '0.72.0',
    linkProtocol: 1,
    endpoints: [],
  } as const;
  let state = reduce(EMPTY_DIRECTORY, { kind: 'hello', registeredAs: null, identity: FREE, frame: hello, fingerprint: 'fp' }, ctx()).state;
  state = phoneHello(phoneHello(state, PHONE), BARE_PHONE);
  const register = { type: 'push-register', platform: 'ios', token: TOKEN, apsEnvironment: 'sandbox' } as const;
  return reduceClient(state, { kind: 'client-frame', clientId: PHONE, frame: register }, ctx()).state;
}

let seq = 0;
function pushFrame(to = PHONE): Extract<MachineToDirectoryFrame, { type: 'push' }> {
  seq += 1;
  return { type: 'push', requestId: seq.toString(16).padStart(32, '0'), to, sealed: SEALED, urgency: 'high', collapseId: COLLAPSE };
}

function push(state: DirectoryState, frame = pushFrame(), over: Partial<ReduceContext> = {}) {
  return { frame, ...reduce(state, { kind: 'frame', registeredAs: ENV, frame }, ctx(over)) };
}

const sends = (effects: DirectoryEffect[]) => effects.filter((e) => e.kind === 'send');
const logs = (effects: DirectoryEffect[]) => effects.filter((e) => e.kind === 'log');
const delivers = (effects: DirectoryEffect[]) => effects.filter((e) => e.kind === 'deliver-push');
const result = (requestId: string, error?: string) => ({
  kind: 'send',
  to: 'self',
  frame: error === undefined ? { type: 'push-result', requestId, ok: true } : { type: 'push-result', requestId, ok: false, error },
});

describe('push answer (PAN-4830 WI-9)', () => {
  it('answers unknown_client for a phone the account does not have, with no delivery', () => {
    const { frame, state, effects } = push(account(), pushFrame(STRANGER));
    expect(sends(effects)).toEqual([result(frame.requestId, 'unknown_client')]);
    expect(delivers(effects)).toEqual([]);
    expect(state.pushWindow).toBeNull();
  });

  it('answers unknown_client for a machine id', () => {
    const { frame, effects } = push(account(), pushFrame(ENV));
    expect(sends(effects)).toEqual([result(frame.requestId, 'unknown_client')]);
  });

  it('answers no_registration for a phone without a push registration', () => {
    const { frame, state, effects } = push(account(), pushFrame(BARE_PHONE));
    expect(sends(effects)).toEqual([result(frame.requestId, 'no_registration')]);
    expect(delivers(effects)).toEqual([]);
    expect(state.pushWindow).toBeNull();
  });

  it('delivers to an offline phone with the stored registration and the frame payload', () => {
    const { frame, state, effects } = push(account(), pushFrame(), { onlineClients: new Set() });
    expect(effects).toEqual([
      { kind: 'put-push-window', window: { minute: MINUTE, count: 1 } },
      {
        kind: 'deliver-push',
        requestId: frame.requestId,
        clientId: PHONE,
        registration: { platform: 'ios', token: TOKEN, apsEnvironment: 'sandbox' },
        sealed: SEALED,
        urgency: 'high',
        collapseId: COLLAPSE,
      },
    ]);
    expect(state.pushWindow).toEqual({ minute: MINUTE, count: 1 });
  });

  it('answers the same whether or not the phone is online', () => {
    const frame = pushFrame();
    const offline = push(account(), frame, { onlineClients: new Set() });
    const online = push(account(), frame, { onlineClients: new Set([PHONE]) });
    expect(online.effects).toEqual(offline.effects);
  });

  it('delivers 30 pushes in one UTC minute and answers the 31st rate_limited', () => {
    let state = account();
    for (let i = 0; i < PUSH_RATE_PER_MINUTE; i++) {
      const step = push(state, pushFrame(), { now: NOW + i * 1_000 });
      expect(delivers(step.effects)).toHaveLength(1);
      state = step.state;
    }
    expect(state.pushWindow).toEqual({ minute: MINUTE, count: PUSH_RATE_PER_MINUTE });
    const limited = push(state, pushFrame(), { now: NOW + 59_000 });
    expect(sends(limited.effects)).toEqual([result(limited.frame.requestId, 'rate_limited')]);
    expect(delivers(limited.effects)).toEqual([]);
    expect(limited.effects.some((e) => e.kind === 'put-push-window')).toBe(false);
    expect(limited.state).toBe(state);

    const next = push(limited.state, pushFrame(), { now: NOW + 60_000 });
    expect(delivers(next.effects)).toHaveLength(1);
    expect(next.effects).toContainEqual({ kind: 'put-push-window', window: { minute: MINUTE + 1, count: 1 } });
  });

  it('does not count refused pushes toward the limit', () => {
    let state = account();
    for (let i = 0; i < 40; i++) state = push(state, pushFrame(BARE_PHONE)).state;
    expect(state.pushWindow).toBeNull();
  });
});

describe('push outcome (PAN-4830 WI-9)', () => {
  const outcome = (state: DirectoryState, o: PushOutcome, token = TOKEN) =>
    reducePushOutcome(state, { requestId: 'r'.repeat(32), clientId: PHONE, environmentId: ENV, token, outcome: o });
  const pushOf = (state: DirectoryState) => state.clients.find((c) => c.clientId === PHONE)?.push;

  it('answers ok:true for a delivered push', () => {
    const state = account();
    const { state: next, effects } = outcome(state, { kind: 'delivered' });
    expect(next).toBe(state);
    expect(effects).toEqual([result('r'.repeat(32)), { kind: 'log', type: 'push', environmentId: ENV, outcome: 'delivered', clientId: PHONE }]);
  });

  it('clears a dead token the phone still holds and answers no_registration', () => {
    const { state, effects } = outcome(account(), { kind: 'gone' });
    expect(pushOf(state)).toBeNull();
    expect(effects).toEqual([
      { kind: 'put-client-push', clientId: PHONE, registration: null },
      result('r'.repeat(32), 'no_registration'),
      { kind: 'log', type: 'push', environmentId: ENV, outcome: 'gone', clientId: PHONE },
    ]);
  });

  it('keeps a registration the phone replaced during the delivery', () => {
    const replaced = reduceClient(
      account(),
      { kind: 'client-frame', clientId: PHONE, frame: { type: 'push-register', platform: 'ios', token: 'new-token' } },
      ctx(),
    ).state;
    const { state, effects } = outcome(replaced, { kind: 'gone' });
    expect(state).toBe(replaced);
    expect(pushOf(state)).toEqual({ platform: 'ios', token: 'new-token', apsEnvironment: 'production' });
    expect(effects.some((e) => e.kind === 'put-client-push')).toBe(false);
    expect(sends(effects)).toEqual([result('r'.repeat(32), 'no_registration')]);
  });

  it('answers delivery_failed for a failed or unconfigured delivery', () => {
    const failed = outcome(account(), { kind: 'failed', detail: 'apns_503' });
    expect(sends(failed.effects)).toEqual([result('r'.repeat(32), 'delivery_failed')]);
    expect(logs(failed.effects)).toEqual([{ kind: 'log', type: 'push', environmentId: ENV, outcome: 'failed_apns_503', clientId: PHONE }]);
    const unconfigured = outcome(account(), { kind: 'not_configured' });
    expect(sends(unconfigured.effects)).toEqual([result('r'.repeat(32), 'delivery_failed')]);
    expect(logs(unconfigured.effects)).toEqual([{ kind: 'log', type: 'push', environmentId: ENV, outcome: 'not_configured', clientId: PHONE }]);
  });

  it('never puts the token or the sealed payload in a log effect', () => {
    const all: DirectoryEffect[] = [];
    let state = account();
    for (const to of [PHONE, BARE_PHONE, STRANGER]) {
      const step = push(state, pushFrame(to));
      state = step.state;
      all.push(...step.effects);
    }
    for (const o of [{ kind: 'delivered' }, { kind: 'gone' }, { kind: 'failed', detail: 'fcm_500' }, { kind: 'not_configured' }] as const) {
      all.push(...outcome(account(), o).effects);
    }
    const logged = JSON.stringify(logs(all));
    expect(logs(all).length).toBeGreaterThan(5);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(SEALED);
  });
});
