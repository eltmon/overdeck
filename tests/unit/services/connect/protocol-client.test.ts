import { describe, expect, it } from 'vitest';
import { decodeFrame, decodeMachineFrame } from '../../../../services/connect/src/protocol.ts';

const CLIENT_ID = '00000000-0000-4000-9000-000000000001';
const ENV = '00000000-0000-4000-8000-000000000001';
const SESSION = 'a'.repeat(32);
const BAD = { ok: false, reason: 'bad_frame' } as const;

const helloClient = (over: Record<string, unknown> = {}) => ({
  type: 'hello-client',
  protocol: 1,
  clientId: CLIENT_ID,
  label: 'phone-1',
  publicKeyHex: '0a'.repeat(32),
  appVersion: '1.0.0',
  platform: 'ios',
  ...over,
});

const hello = {
  type: 'hello',
  protocol: 1,
  environmentId: ENV,
  label: 'machine-1',
  publicKeyHex: '01'.repeat(32),
  serverVersion: '0.72.0',
  linkProtocol: 1,
  endpoints: [],
};

const clientSignal = (purpose: string) => ({
  type: 'signal',
  to: ENV,
  session: SESSION,
  purpose,
  relay: false,
  data: { sdp: { type: 'offer', sdp: 'v=0' } },
});

const asClient = (frame: unknown) => decodeFrame(JSON.stringify(frame), 'client');

describe('decodeFrame for client sockets (PAN-4829 WI-2)', () => {
  it('round-trips a valid hello-client and drops an extra key', () => {
    expect(asClient({ ...helloClient(), extra: 'dropped' })).toEqual({ ok: true, role: 'client', frame: helloClient() });
  });

  it('answers unsupported to a hello-client for another protocol version', () => {
    expect(asClient(helloClient({ protocol: 2 }))).toEqual({ ok: false, reason: 'unsupported' });
    expect(decodeFrame(JSON.stringify(helloClient({ protocol: 2 })), null)).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('rejects malformed hello-client fields as bad_frame', () => {
    expect(asClient(helloClient({ clientId: 'not-a-uuid' }))).toEqual(BAD);
    expect(asClient(helloClient({ label: 'x'.repeat(65) }))).toEqual(BAD);
    expect(asClient(helloClient({ appVersion: 'x'.repeat(33) }))).toEqual(BAD);
    expect(asClient(helloClient({ platform: 'web' }))).toEqual(BAD);
    expect(asClient(helloClient({ publicKeyHex: 'zz'.repeat(32) }))).toEqual(BAD);
    expect(asClient(helloClient({ protocol: '1' }))).toEqual(BAD);
  });

  it('accepts a link signal and refuses an approval signal from a client', () => {
    expect(asClient(clientSignal('link'))).toEqual({ ok: true, role: 'client', frame: clientSignal('link') });
    expect(asClient(clientSignal('approval'))).toEqual(BAD);
  });

  it('decodes ice-servers, relay-usage and forget-client with the machine rules', () => {
    expect(asClient({ type: 'ice-servers', requestId: 'r-1', relay: true })).toEqual({
      ok: true,
      role: 'client',
      frame: { type: 'ice-servers', requestId: 'r-1', relay: true },
    });
    expect(asClient({ type: 'relay-usage', bytes: 42 })).toEqual({ ok: true, role: 'client', frame: { type: 'relay-usage', bytes: 42 } });
    expect(asClient({ type: 'relay-usage', bytes: -1 })).toEqual(BAD);
    expect(asClient({ type: 'forget-client', extra: 1 })).toEqual({ ok: true, role: 'client', frame: { type: 'forget-client' } });
  });

  it('decodes push-register and push-unregister (PAN-4830 D-6)', () => {
    const token = 'a1'.repeat(32);
    expect(asClient({ type: 'push-register', platform: 'ios', token, extra: 1 })).toEqual({
      ok: true,
      role: 'client',
      frame: { type: 'push-register', platform: 'ios', token },
    });
    expect(asClient({ type: 'push-register', platform: 'ios', token, apsEnvironment: 'sandbox' })).toEqual({
      ok: true,
      role: 'client',
      frame: { type: 'push-register', platform: 'ios', token, apsEnvironment: 'sandbox' },
    });
    const fcm = 'fA1:APA91b_x-y.z';
    expect(asClient({ type: 'push-register', platform: 'android', token: fcm })).toEqual({
      ok: true,
      role: 'client',
      frame: { type: 'push-register', platform: 'android', token: fcm },
    });
    expect(asClient({ type: 'push-register', platform: 'ios', token: 'x'.repeat(4096) })).toMatchObject({ ok: true });
    expect(asClient({ type: 'push-unregister', extra: 1 })).toEqual({ ok: true, role: 'client', frame: { type: 'push-unregister' } });
  });

  it.each([
    ['a 4,097-char token', { platform: 'ios', token: 'x'.repeat(4097) }],
    ['a token with a slash', { platform: 'ios', token: 'ab/cd' }],
    ['a token with a percent sign', { platform: 'ios', token: 'ab%2F' }],
    ['a token with a space', { platform: 'ios', token: 'ab cd' }],
    ['an empty token', { platform: 'ios', token: '' }],
    ['apsEnvironment on android', { platform: 'android', token: 't', apsEnvironment: 'production' }],
    ['apsEnvironment dev', { platform: 'ios', token: 't', apsEnvironment: 'dev' }],
    ['apsEnvironment null', { platform: 'ios', token: 't', apsEnvironment: null }],
    ['platform web', { platform: 'web', token: 't' }],
  ])('refuses push-register with %s', (_name, over) => {
    expect(asClient({ type: 'push-register', ...over })).toEqual(BAD);
  });

  it('refuses push-register and push-unregister from a machine socket', () => {
    expect(decodeFrame(JSON.stringify({ type: 'push-register', platform: 'ios', token: 't' }), 'machine')).toEqual(BAD);
    expect(decodeFrame(JSON.stringify({ type: 'push-unregister' }), 'machine')).toEqual(BAD);
  });

  it('refuses cross-role frames', () => {
    expect(asClient(hello)).toEqual(BAD);
    expect(asClient({ type: 'endpoints', endpoints: [] })).toEqual(BAD);
    expect(asClient({ type: 'approval-cancel', requestId: SESSION })).toEqual(BAD);
    expect(decodeFrame(JSON.stringify(helloClient()), 'machine')).toEqual(BAD);
    expect(decodeFrame(JSON.stringify({ type: 'forget-client' }), 'machine')).toEqual(BAD);
  });

  it('decodes a first frame by its type when the socket has no role yet', () => {
    expect(decodeFrame(JSON.stringify(helloClient()), null)).toMatchObject({ ok: true, role: 'client', frame: { type: 'hello-client' } });
    expect(decodeFrame(JSON.stringify(hello), null)).toMatchObject({ ok: true, role: 'machine', frame: { type: 'hello' } });
    expect(decodeFrame(JSON.stringify({ type: 'forget-client' }), null)).toEqual(BAD);
  });

  it('rejects binary, oversize and non-object input for every role', () => {
    for (const role of ['client', 'machine', null] as const) {
      expect(decodeFrame(new ArrayBuffer(4), role)).toEqual(BAD);
      expect(decodeFrame('not json', role)).toEqual(BAD);
      expect(decodeFrame('[]', role)).toEqual(BAD);
      expect(decodeFrame(JSON.stringify({ ...helloClient(), pad: 'x'.repeat(65_536) }), role)).toEqual(BAD);
    }
  });

  it('leaves decodeMachineFrame results unchanged', () => {
    expect(decodeMachineFrame(JSON.stringify(hello))).toEqual({ ok: true, frame: hello });
    expect(decodeMachineFrame(JSON.stringify({ ...hello, protocol: 2 }))).toEqual({ ok: false, reason: 'unsupported' });
    expect(decodeMachineFrame(JSON.stringify(helloClient()))).toEqual(BAD);
    expect(decodeMachineFrame('nope')).toEqual(BAD);
  });
});
