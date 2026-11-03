import { describe, expect, it } from 'vitest';
import { ACTIVITY_PUSH_RATE_PER_MINUTE, RELAY_MONTHLY_CAP_BYTES } from '../../../../packages/contracts/src/connect.ts';
import type { ClientPlatform, MachineToDirectoryFrame } from '../../../../packages/contracts/src/connect.ts';
import { reduceActivityOutcome } from '../../../../services/connect/src/activity-state.ts';
import { reduceClient } from '../../../../services/connect/src/client-state.ts';
import { EMPTY_DIRECTORY, reduce } from '../../../../services/connect/src/directory-state.ts';
import type { DirectoryEffect, DirectoryState, ReduceContext, SocketIdentity } from '../../../../services/connect/src/directory-state.ts';

// A minute boundary, so pushes a few seconds apart share one rate window.
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const FREE: SocketIdentity = { deviceId: 'd-1', plan: 'free', maxDevices: 3 };
const ENV_A = '00000000-0000-4000-8000-000000000001';
const ENV_B = '00000000-0000-4000-8000-000000000002';
const PHONE = '00000000-0000-4000-9000-000000000001';
const ANDROID = '00000000-0000-4000-9000-000000000002';
const STRANGER = '00000000-0000-4000-9000-0000000000ff';
const TOKEN = 'a1'.repeat(32);
const NEW_TOKEN = 'b2'.repeat(32);
const PUSH_TOKEN = 'f0'.repeat(32);

function ctx(now = NOW): ReduceContext {
  return { now, online: new Set(), stunUrls: [], relayCapBytes: RELAY_MONTHLY_CAP_BYTES, turnConfigured: false };
}

function machineHello(state: DirectoryState, environmentId: string): DirectoryState {
  const frame = {
    type: 'hello',
    protocol: 1,
    environmentId,
    label: `machine-${environmentId.slice(-1)}`,
    publicKeyHex: '01'.repeat(32),
    serverVersion: '0.73.0',
    linkProtocol: 1,
    endpoints: [],
  } as const;
  return reduce(state, { kind: 'hello', registeredAs: null, identity: FREE, frame, fingerprint: 'fp' }, ctx()).state;
}

function phoneHello(state: DirectoryState, clientId: string, platform: ClientPlatform): DirectoryState {
  const frame = { type: 'hello-client', protocol: 1, clientId, label: 'phone', publicKeyHex: 'ab'.repeat(32), appVersion: '1.0.0', platform } as const;
  return reduceClient(state, { kind: 'hello-client', registeredAs: null, identity: FREE, frame }, ctx()).state;
}

/** Two machines, one iOS phone and one Android phone; nothing registered for Live Activity yet. */
function account(): DirectoryState {
  return phoneHello(phoneHello(machineHello(machineHello(EMPTY_DIRECTORY, ENV_A), ENV_B), PHONE, 'ios'), ANDROID, 'android');
}

function register(state: DirectoryState, now = NOW, token = TOKEN, clientId = PHONE) {
  const frame = { type: 'activity-register', token, apsEnvironment: 'sandbox' } as const;
  return reduceClient(state, { kind: 'client-frame', clientId, frame }, ctx(now));
}

function report(state: DirectoryState, env: string, needsYou: number, running: number, now = NOW, to = PHONE) {
  const frame: MachineToDirectoryFrame = { type: 'push-activity', to, needsYou, running };
  return reduce(state, { kind: 'frame', registeredAs: env, frame }, ctx(now));
}

const delivers = (effects: DirectoryEffect[]) => effects.filter((e) => e.kind === 'deliver-activity');
const outcomes = (effects: DirectoryEffect[]) => effects.flatMap((e) => (e.kind === 'log' ? [e.outcome] : []));

describe('Live Activity reducer (PAN-4839 WI-4)', () => {
  it('pushes the sum of two machines’ reports for one registered phone', () => {
    let state = register(account()).state;
    state = report(state, ENV_A, 2, 1).state;
    const { effects } = report(state, ENV_B, 1, 0, NOW + 1_000);
    expect(delivers(effects)).toEqual([
      { kind: 'deliver-activity', clientId: PHONE, token: TOKEN, apsEnvironment: 'sandbox', needsYou: 3, running: 1, priority: 'high' },
    ]);
  });

  it('drops a report older than 600,000 ms out of the sum', () => {
    let state = register(account()).state;
    state = report(state, ENV_A, 2, 1).state;
    const { effects } = report(state, ENV_B, 1, 0, NOW + 600_001);
    expect(delivers(effects)).toMatchObject([{ needsYou: 1, running: 0 }]);
  });

  it('holds an identical report until 240,000 ms after the push, then refreshes at priority normal', () => {
    let state = register(account()).state;
    state = report(state, ENV_A, 2, 1).state;
    const early = report(state, ENV_A, 2, 1, NOW + 239_999);
    expect(delivers(early.effects)).toEqual([]);
    expect(outcomes(early.effects)).toContain('unchanged');
    const due = report(early.state, ENV_A, 2, 1, NOW + 240_000);
    expect(delivers(due.effects)).toMatchObject([{ needsYou: 2, running: 1, priority: 'normal' }]);
  });

  it('pushes a changed sum at priority high', () => {
    let state = register(account()).state;
    state = report(state, ENV_A, 2, 1).state;
    const { effects } = report(state, ENV_A, 3, 1, NOW + 1_000);
    expect(delivers(effects)).toMatchObject([{ needsYou: 3, running: 1, priority: 'high' }]);
  });

  it('rate-limits the 61st Live Activity push in a minute and keeps the alert push window apart', () => {
    let state = register(account()).state;
    for (let i = 0; i < ACTIVITY_PUSH_RATE_PER_MINUTE; i++) {
      const step = report(state, ENV_A, i, 0, NOW + i * 100);
      expect(delivers(step.effects)).toHaveLength(1);
      state = step.state;
    }
    const limited = report(state, ENV_A, 999, 0, NOW + 59_000);
    expect(delivers(limited.effects)).toEqual([]);
    expect(outcomes(limited.effects)).toContain('rate_limited');
    expect(limited.state.activityWindow?.count).toBe(ACTIVITY_PUSH_RATE_PER_MINUTE);

    const pushRegister = { type: 'push-register', platform: 'ios', token: PUSH_TOKEN } as const;
    state = reduceClient(limited.state, { kind: 'client-frame', clientId: PHONE, frame: pushRegister }, ctx(NOW + 59_000)).state;
    const alert: MachineToDirectoryFrame = {
      type: 'push',
      requestId: '0'.repeat(32),
      to: PHONE,
      sealed: 'AAAA',
      urgency: 'high',
      collapseId: 'c'.repeat(32),
    };
    const pushed = reduce(state, { kind: 'frame', registeredAs: ENV_A, frame: alert }, ctx(NOW + 59_500));
    expect(pushed.effects.filter((e) => e.kind === 'deliver-push')).toHaveLength(1);
  });

  it('answers bad_frame to activity-register from an Android phone', () => {
    const { state, effects } = register(account(), NOW, TOKEN, ANDROID);
    expect(effects).toContainEqual({ kind: 'send', to: 'self', frame: { type: 'error', code: 'bad_frame', message: 'live activities are iOS only' } });
    expect(outcomes(effects)).toEqual(['platform_mismatch']);
    expect(state.clients.find((c) => c.clientId === ANDROID)?.activity).toBeNull();
  });

  it('pushes at once on register when a fresh report exists, and stores the registration once', () => {
    const reported = report(account(), ENV_A, 4, 2);
    expect(outcomes(reported.effects)).toEqual(['no_registration']);
    const { state, effects } = register(reported.state, NOW + 5_000);
    expect(delivers(effects)).toMatchObject([{ needsYou: 4, running: 2, priority: 'high' }]);
    expect(effects.filter((e) => e.kind === 'put-client-activity')).toHaveLength(1);
    expect(state.clients.find((c) => c.clientId === PHONE)?.activity?.lastPushed).toEqual({ needsYou: 4, running: 2, at: NOW + 5_000 });
  });

  it('stores a registration with no push when no report is fresh', () => {
    const { state, effects } = register(account());
    expect(delivers(effects)).toEqual([]);
    expect(effects).toContainEqual({
      kind: 'put-client-activity',
      clientId: PHONE,
      registration: { token: TOKEN, apsEnvironment: 'sandbox', lastPushed: null },
    });
    expect(state.clients.find((c) => c.clientId === PHONE)?.activity?.token).toBe(TOKEN);
  });

  it('clears the registration on activity-unregister and ignores reports for strangers', () => {
    const registered = register(account()).state;
    const unregistered = reduceClient(registered, { kind: 'client-frame', clientId: PHONE, frame: { type: 'activity-unregister' } }, ctx());
    expect(unregistered.effects).toContainEqual({ kind: 'put-client-activity', clientId: PHONE, registration: null });
    expect(unregistered.state.clients.find((c) => c.clientId === PHONE)?.activity).toBeNull();

    const stranger = report(registered, ENV_A, 1, 1, NOW, STRANGER);
    expect(stranger.state).toEqual(registered);
    expect(outcomes(stranger.effects)).toEqual(['unknown_client']);
  });

  it('keeps a newer registration when the old token comes back gone', () => {
    const state = register(register(account()).state, NOW + 1_000, NEW_TOKEN).state;
    const { state: after, effects } = reduceActivityOutcome(state, { clientId: PHONE, token: TOKEN, outcome: { kind: 'gone' } });
    expect(after.clients.find((c) => c.clientId === PHONE)?.activity?.token).toBe(NEW_TOKEN);
    expect(effects.filter((e) => e.kind === 'put-client-activity')).toEqual([]);

    const cleared = reduceActivityOutcome(state, { clientId: PHONE, token: NEW_TOKEN, outcome: { kind: 'gone' } });
    expect(cleared.state.clients.find((c) => c.clientId === PHONE)?.activity).toBeNull();
  });

  it('forgets the last push after a failed delivery, so the next report pushes again', () => {
    let state = register(account()).state;
    state = report(state, ENV_A, 2, 1).state;
    const failed = reduceActivityOutcome(state, { clientId: PHONE, token: TOKEN, outcome: { kind: 'failed', detail: 'apns_403' } });
    expect(outcomes(failed.effects)).toEqual(['failed_apns_403']);
    expect(failed.state.clients.find((c) => c.clientId === PHONE)?.activity?.lastPushed).toBeNull();
    expect(delivers(report(failed.state, ENV_A, 2, 1, NOW + 1_000).effects)).toHaveLength(1);
  });

  it('drops a forgotten machine’s and a forgotten phone’s reports', () => {
    let state = register(account()).state;
    state = report(state, ENV_A, 2, 1).state;
    state = report(state, ENV_B, 1, 0).state;
    const forgetB: MachineToDirectoryFrame = { type: 'forget', environmentId: ENV_B };
    state = reduce(state, { kind: 'frame', registeredAs: ENV_A, frame: forgetB }, ctx()).state;
    expect(state.activityReports.map((r) => r.environmentId)).toEqual([ENV_A]);
    state = reduceClient(state, { kind: 'client-frame', clientId: PHONE, frame: { type: 'forget-client' } }, ctx()).state;
    expect(state.activityReports).toEqual([]);
  });

  it('carries only ids, the two numbers and the activity token, and the token only where it is stored or sent', () => {
    const title = 'Approve the production deploy?';
    let state = account();
    const effects: DirectoryEffect[] = [];
    const run = (r: { state: DirectoryState; effects: DirectoryEffect[] }) => {
      state = r.state;
      effects.push(...r.effects);
    };
    // A frame with an extra key (the decoder drops it; the reducer must not read it either).
    const withTitle = { type: 'push-activity', to: PHONE, needsYou: 2, running: 1, title } as MachineToDirectoryFrame;
    run(reduce(state, { kind: 'frame', registeredAs: ENV_A, frame: withTitle }, ctx()));
    run(register(state, NOW + 1_000));
    run(report(state, ENV_B, 1, 1, NOW + 2_000));
    run(reduceActivityOutcome(state, { clientId: PHONE, token: TOKEN, outcome: { kind: 'failed', detail: 'apns_500' } }));
    run(reduceActivityOutcome(state, { clientId: PHONE, token: TOKEN, outcome: { kind: 'gone' } }));

    const serialized = JSON.stringify(effects);
    expect(serialized).not.toContain(title);
    expect(serialized).not.toContain('machine-');
    expect(serialized).not.toContain('phone"');
    for (const e of effects) {
      if (JSON.stringify(e).includes(TOKEN)) expect(['put-client-activity', 'deliver-activity']).toContain(e.kind);
    }
    for (const e of delivers(effects)) {
      expect(Object.keys(e).sort()).toEqual(['apsEnvironment', 'clientId', 'kind', 'needsYou', 'priority', 'running', 'token']);
    }
  });
});
