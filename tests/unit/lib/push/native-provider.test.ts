import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  PUSH_PLAINTEXT_MAX_BYTES,
  PUSH_SEALED_MAX_CHARS,
  type MachineToDirectoryFrame,
  type PhoneNotificationPreferences,
  type PushResultError,
} from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineKeyPair } from '../../../../src/lib/anywhere/machine-key.js';
import { openSealed } from '../../../../src/lib/anywhere/sealed-box.js';
import {
  buildPhonePushPayload,
  createNativePushProvider,
  fitPhonePushPayload,
  NATIVE_PUSH_RESULT_TIMEOUT_MS,
  pushCollapseId,
  type PushDirectoryPort,
} from '../../../../src/lib/push/native-provider.js';
import type { NeedsYouNotification } from '../../../../src/lib/push/types.js';

function notification(overrides: Partial<NeedsYouNotification> = {}): NeedsYouNotification {
  return {
    kind: 'question',
    category: 'question',
    tag: 'auq:toolu_01',
    title: 'PAN-1 work asks a question',
    publicTitle: 'PAN-1 needs you',
    body: 'Should I delete the staging database?',
    url: '/m?subject=agent-pan-1',
    issueId: 'PAN-1',
    ts: '2026-11-03T00:00:00.000Z',
    ...overrides,
  };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('phone push payload (PAN-4843)', () => {
  it('builds the D-3 payload with the full title', () => {
    expect(buildPhonePushPayload(notification(), 'env-1')).toEqual({
      v: 1,
      machine: 'env-1',
      kind: 'question',
      title: 'PAN-1 work asks a question',
      body: 'Should I delete the staging database?',
      url: '/m?subject=agent-pan-1',
      tag: 'auq:toolu_01',
      issueId: 'PAN-1',
      ts: '2026-11-03T00:00:00.000Z',
    });
  });

  it('trims a 5,000-byte body and keeps url, tag and machine', () => {
    const payload = buildPhonePushPayload(notification({ body: 'x'.repeat(5000) }), 'env-1');
    const fitted = fitPhonePushPayload(payload);
    expect(fitted).not.toBeNull();
    expect(bytes(fitted)).toBeLessThanOrEqual(PUSH_PLAINTEXT_MAX_BYTES);
    expect(fitted?.body.endsWith('…')).toBe(true);
    expect(fitted?.url).toBe(payload.url);
    expect(fitted?.tag).toBe(payload.tag);
    expect(fitted?.machine).toBe('env-1');
  });

  it('trims an emoji body on code-point boundaries', () => {
    const fitted = fitPhonePushPayload(buildPhonePushPayload(notification({ body: '😀'.repeat(3000) }), 'env-1'));
    expect(bytes(fitted)).toBeLessThanOrEqual(PUSH_PLAINTEXT_MAX_BYTES);
    const codePoints = Array.from(fitted?.body ?? '');
    expect(codePoints.at(-1)).toBe('…');
    for (const point of codePoints.slice(0, -1)) expect(point.codePointAt(0)).toBe(0x1f600);
  });

  it('counts JSON escapes when trimming a body of quotes', () => {
    const fitted = fitPhonePushPayload(buildPhonePushPayload(notification({ body: '"'.repeat(2000) }), 'env-1'));
    expect(fitted).not.toBeNull();
    expect(bytes(fitted)).toBeLessThanOrEqual(PUSH_PLAINTEXT_MAX_BYTES);
  });

  it('trims the title and keeps an empty body when the title alone is too long', () => {
    const fitted = fitPhonePushPayload(buildPhonePushPayload(notification({ title: 't'.repeat(3000), body: '' }), 'env-1'));
    expect(fitted?.body).toBe('');
    expect(fitted?.title.endsWith('…')).toBe(true);
    expect(bytes(fitted)).toBeLessThanOrEqual(PUSH_PLAINTEXT_MAX_BYTES);
  });

  it('returns null when the url alone does not fit', () => {
    expect(fitPhonePushPayload(buildPhonePushPayload(notification({ url: `/${'u'.repeat(3000)}` }), 'env-1'))).toBeNull();
  });

  it('returns a short payload unchanged', () => {
    const payload = buildPhonePushPayload(notification(), 'env-1');
    expect(fitPhonePushPayload(payload)).toEqual(payload);
  });

  it('derives the collapse id from the first 32 hex characters of sha256(tag)', () => {
    const id = pushCollapseId('auq:toolu_01');
    expect(id).toBe(createHash('sha256').update('auq:toolu_01').digest('hex').slice(0, 32));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});

interface Sodium {
  crypto_box_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
}
const sodium = createRequire(import.meta.url)('sodium-native') as Sodium;

function seededKeyPair(fill: number): MachineKeyPair {
  const publicKey = Buffer.alloc(32);
  const secretKey = Buffer.alloc(32);
  sodium.crypto_box_seed_keypair(publicKey, secretKey, Buffer.alloc(32, fill));
  return { publicKey, secretKey };
}

const PHONE_A = { clientId: 'aaaaaaaa-0000-4000-8000-000000000001', keys: seededKeyPair(0x11) };
const PHONE_B = { clientId: 'bbbbbbbb-0000-4000-8000-000000000002', keys: seededKeyPair(0x22) };
const PHONES = [PHONE_A, PHONE_B].map(({ clientId, keys }) => ({ clientId, pushKey: keys.publicKey.toString('hex') }));

type PushFrame = Extract<MachineToDirectoryFrame, { type: 'push' }>;
type PushResultHandler = Parameters<PushDirectoryPort['on']>[1];

/** A directory port that records `push` frames and lets the test answer them. */
function fakePort(options: { online?: boolean; accept?: boolean; answer?: (frame: PushFrame) => Parameters<PushResultHandler>[0] | null } = {}) {
  const handlers = new Set<PushResultHandler>();
  const frames: PushFrame[] = [];
  const port: PushDirectoryPort = {
    isOnline: () => options.online ?? true,
    send(frame) {
      if (!(options.accept ?? true)) return false;
      if (frame.type === 'push') {
        frames.push(frame);
        const reply = options.answer?.(frame);
        if (reply) for (const handler of [...handlers]) handler(reply);
      }
      return true;
    },
    on(_type, handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  const emit = (frame: Parameters<PushResultHandler>[0]) => {
    for (const handler of [...handlers]) handler(frame);
  };
  return { port, frames, emit, handlerCount: () => handlers.size };
}

const okReply = (frame: PushFrame) => ({ type: 'push-result' as const, requestId: frame.requestId, ok: true as const });

function provider(
  port: PushDirectoryPort | null,
  phones = PHONES,
  overrides: { readPreferences?: () => Promise<ReadonlyMap<string, PhoneNotificationPreferences>>; now?: () => number } = {},
) {
  return createNativePushProvider({
    directory: () => port,
    listPhones: () => phones,
    environmentId: async () => 'env-1',
    ...overrides,
  });
}

function openFrame(frame: PushFrame, keys: MachineKeyPair): unknown {
  const opened = openSealed(Buffer.from(frame.sealed, 'base64'), keys);
  return opened === null ? null : JSON.parse(opened.toString('utf8'));
}

describe('native push provider (PAN-4843)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('seals one push per phone that opens only with that phone\'s key', async () => {
    const fake = fakePort({ answer: okReply });
    const n = notification();
    const outcomes = await provider(fake.port).send(n);

    expect(outcomes).toEqual([
      { target: `native:${PHONE_A.clientId}`, ok: true },
      { target: `native:${PHONE_B.clientId}`, ok: true },
    ]);
    expect(fake.frames.map((frame) => frame.to)).toEqual([PHONE_A.clientId, PHONE_B.clientId]);
    const expected = buildPhonePushPayload(n, 'env-1');
    const [frameA, frameB] = fake.frames as [PushFrame, PushFrame];
    expect(openFrame(frameA, PHONE_A.keys)).toEqual(expected);
    expect(openFrame(frameB, PHONE_B.keys)).toEqual(expected);
    expect(openFrame(frameA, PHONE_B.keys)).toBeNull();
    expect(openFrame(frameB, PHONE_A.keys)).toBeNull();
    for (const frame of fake.frames) {
      expect(frame.urgency).toBe('high');
      expect(frame.collapseId).toBe(pushCollapseId(n.tag));
      expect(frame.requestId).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(new Set(fake.frames.map((frame) => frame.requestId)).size).toBe(2);
  });

  it('sends normal urgency for a finished notification', async () => {
    const fake = fakePort({ answer: okReply });
    await provider(fake.port).send(notification({ kind: 'finished' }));
    expect(fake.frames.map((frame) => frame.urgency)).toEqual(['normal', 'normal']);
  });

  it('seals a payload trimmed to exactly 2,256 bytes into exactly 3,072 characters', async () => {
    const fake = fakePort({ answer: okReply });
    await provider(fake.port).send(notification({ body: 'x'.repeat(5000) }));
    const [frame] = fake.frames as [PushFrame];
    const opened = openFrame(frame, PHONE_A.keys);
    expect(Buffer.byteLength(JSON.stringify(opened), 'utf8')).toBe(PUSH_PLAINTEXT_MAX_BYTES);
    expect(frame.sealed.length).toBe(PUSH_SEALED_MAX_CHARS);
  });

  it.each<[PushResultError, 'skipped' | 'transient']>([
    ['no_registration', 'skipped'],
    ['unknown_client', 'skipped'],
    ['rate_limited', 'transient'],
    ['delivery_failed', 'transient'],
  ])('maps push-result error %s to %s', async (error, reason) => {
    const fake = fakePort({ answer: (frame) => ({ type: 'push-result', requestId: frame.requestId, ok: false, error }) });
    const outcomes = await provider(fake.port, PHONES.slice(0, 1)).send(notification());
    expect(outcomes).toEqual([{ target: `native:${PHONE_A.clientId}`, ok: false, reason, detail: error }]);
    expect(fake.handlerCount()).toBe(0);
  });

  it('ignores a push-result for another request', async () => {
    const fake = fakePort();
    const pending = provider(fake.port, PHONES.slice(0, 1)).send(notification());
    await vi.advanceTimersByTimeAsync(0);
    fake.emit({ type: 'push-result', requestId: 'f'.repeat(32), ok: true });
    const [frame] = fake.frames as [PushFrame];
    fake.emit(okReply(frame));
    expect(await pending).toEqual([{ target: `native:${PHONE_A.clientId}`, ok: true }]);
  });

  it('times out after 10 s with no answer and unsubscribes', async () => {
    const fake = fakePort();
    const pending = provider(fake.port, PHONES.slice(0, 1)).send(notification());
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.handlerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(NATIVE_PUSH_RESULT_TIMEOUT_MS);
    expect(await pending).toEqual([{ target: `native:${PHONE_A.clientId}`, ok: false, reason: 'transient', detail: 'timeout' }]);
    expect(fake.handlerCount()).toBe(0);
  });

  it('reports directory-offline without waiting when there is no directory, it is offline, or send fails', async () => {
    const offline = { target: `native:${PHONE_A.clientId}`, ok: false, reason: 'transient', detail: 'directory-offline' };
    expect(await provider(null, PHONES.slice(0, 1)).send(notification())).toEqual([offline]);
    expect(await provider(fakePort({ online: false }).port, PHONES.slice(0, 1)).send(notification())).toEqual([offline]);
    const refusing = fakePort({ accept: false });
    expect(await provider(refusing.port, PHONES.slice(0, 1)).send(notification())).toEqual([offline]);
    expect(refusing.handlerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers payload-too-large for every phone and sends nothing when the payload cannot fit', async () => {
    const fake = fakePort({ answer: okReply });
    const outcomes = await provider(fake.port).send(notification({ url: `/${'u'.repeat(3000)}` }));
    expect(outcomes.map((outcome) => !outcome.ok && outcome.detail)).toEqual(['payload-too-large', 'payload-too-large']);
    expect(outcomes.every((outcome) => !outcome.ok && outcome.reason === 'rejected')).toBe(true);
    expect(fake.frames).toEqual([]);
  });

  it('logs no key, sealed text or notification text', async () => {
    const fake = fakePort();
    const pending = provider(fake.port, PHONES.slice(0, 1)).send(notification());
    await vi.advanceTimersByTimeAsync(NATIVE_PUSH_RESULT_TIMEOUT_MS);
    await pending;
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(logged).toBe(`[push] native (${PHONE_A.clientId.slice(0, 8)}…) timeout`);
  });

  it('has targets only with phones and an online directory', async () => {
    expect(await provider(fakePort().port, []).hasTargets()).toBe(false);
    expect(await provider(fakePort({ online: false }).port).hasTargets()).toBe(false);
    expect(await provider(null).hasTargets()).toBe(false);
    expect(await provider(fakePort().port).hasTargets()).toBe(true);
  });

  it('returns no outcomes and sends nothing without phones', async () => {
    const fake = fakePort({ answer: okReply });
    expect(await provider(fake.port, []).send(notification())).toEqual([]);
    expect(fake.frames).toEqual([]);
  });

  it('omits an indefinitely paused phone and sends only to the other (PAN-5019 D-1)', async () => {
    const fake = fakePort({ answer: okReply });
    const prefs = new Map([[PHONE_A.clientId, { v: 1 as const, pause: { until: null }, muted: [] }]]);
    const outcomes = await provider(fake.port, PHONES, { readPreferences: async () => prefs }).send(notification());
    expect(outcomes).toEqual([{ target: `native:${PHONE_B.clientId}`, ok: true }]);
    expect(fake.frames.map((frame) => frame.to)).toEqual([PHONE_B.clientId]);
  });

  it('withholds a muted category from one phone but still sends an unmuted category', async () => {
    const fake = fakePort({ answer: okReply });
    const prefs = new Map([[PHONE_A.clientId, { v: 1 as const, pause: null, muted: ['stopped' as const] }]]);
    const deps = { readPreferences: async () => prefs };

    const stopped = await provider(fake.port, PHONES, deps).send(notification({ category: 'stopped' }));
    expect(stopped).toEqual([{ target: `native:${PHONE_B.clientId}`, ok: true }]);

    fake.frames.length = 0;
    const question = await provider(fake.port, PHONES, deps).send(notification({ category: 'question' }));
    expect(question.map((outcome) => outcome.target)).toEqual([`native:${PHONE_A.clientId}`, `native:${PHONE_B.clientId}`]);
  });

  it('reaches a paused phone with a test notification', async () => {
    const fake = fakePort({ answer: okReply });
    const prefs = new Map([[PHONE_A.clientId, { v: 1 as const, pause: { until: null }, muted: [] }]]);
    const outcomes = await provider(fake.port, PHONES, { readPreferences: async () => prefs }).send(notification({ kind: 'test', category: 'test' }));
    expect(outcomes.map((outcome) => outcome.target)).toEqual([`native:${PHONE_A.clientId}`, `native:${PHONE_B.clientId}`]);
  });

  it('delivers to a phone whose pause until is already in the past', async () => {
    const fake = fakePort({ answer: okReply });
    const prefs = new Map([[PHONE_A.clientId, { v: 1 as const, pause: { until: '2026-11-01T00:00:00.000Z' }, muted: [] }]]);
    const outcomes = await provider(fake.port, PHONES, {
      readPreferences: async () => prefs,
      now: () => Date.parse('2026-11-02T00:00:00.000Z'),
    }).send(notification());
    expect(outcomes.map((outcome) => outcome.target)).toEqual([`native:${PHONE_A.clientId}`, `native:${PHONE_B.clientId}`]);
  });

  it('sends to every phone when readPreferences rejects (fail open, NFR-1)', async () => {
    const fake = fakePort({ answer: okReply });
    const outcomes = await provider(fake.port, PHONES, { readPreferences: async () => { throw new Error('store unreadable'); } }).send(notification());
    expect(outcomes.map((outcome) => outcome.target)).toEqual([`native:${PHONE_A.clientId}`, `native:${PHONE_B.clientId}`]);
  });
});
