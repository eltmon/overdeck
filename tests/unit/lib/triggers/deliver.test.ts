/**
 * PAN-4648 W-4: trigger delivery core — secret and signature refusals, the
 * pending-input hold, target-gone mapping, harness pass-through, the rolling
 * rate limit, and the CPU hold. Every dependency is faked and `now` is
 * injected, so no real timers run.
 */
import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetTriggerRateLimitsForTests,
  deliverTriggerEvent,
  type TriggerDeliveryDeps,
} from '../../../../src/lib/triggers/deliver.js';
import { hashUrlSecret, type TriggerRecord } from '../../../../src/lib/triggers/store.js';

const URL_SECRET = 'a'.repeat(64);
const HOUR = 3_600_000;

function record(overrides: Partial<TriggerRecord> = {}): TriggerRecord {
  return {
    id: 'trg_000000000001',
    name: 'ci',
    secretHash: hashUrlSecret(URL_SECRET),
    target: { kind: 'conversation', conversation: '20261101-0001' },
    template: null,
    verify: 'none',
    signingSecret: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const projectRecord = (overrides: Partial<TriggerRecord> = {}): TriggerRecord =>
  record({ target: { kind: 'project', projectKey: 'overdeck' }, template: 'Look at this.', ...overrides });

function deps(triggers: TriggerRecord[], overrides: Partial<TriggerDeliveryDeps> = {}) {
  let clock = 1_800_000_000_000;
  const fake = {
    readTriggers: vi.fn(async () => triggers),
    now: vi.fn(() => clock),
    cpuPressure: vi.fn(async () => ({ saturated: false })),
    pendingInputKinds: vi.fn(async (): Promise<string[] | null> => []),
    sendMessage: vi.fn(async () => ({ status: 200, body: { success: true } })),
    startConversation: vi.fn(async () => ({ status: 201, body: { name: '20261101-0042', id: 42 } })),
    log: vi.fn(),
    ...overrides,
  };
  return { deps: fake, advance: (ms: number) => (clock += ms) };
}

const event = (overrides: Partial<Parameters<typeof deliverTriggerEvent>[0]> = {}) => ({
  triggerId: 'trg_000000000001',
  urlSecret: URL_SECRET,
  headers: {},
  rawBody: Buffer.from('{"hello":"world"}'),
  ...overrides,
});

beforeEach(() => {
  _resetTriggerRateLimitsForTests();
});

describe('deliverTriggerEvent (PAN-4648)', () => {
  it('answers an unknown id and a wrong secret with identical 404s', async () => {
    const { deps: d } = deps([record()]);
    const unknown = await deliverTriggerEvent(event({ triggerId: 'trg_ffffffffffff' }), d);
    const wrong = await deliverTriggerEvent(event({ urlSecret: 'b'.repeat(64) }), d);
    expect(unknown).toEqual({ status: 404, body: { error: 'not found' } });
    expect(wrong).toEqual(unknown);
    expect(d.sendMessage).not.toHaveBeenCalled();
  });

  it('refuses a bad GitHub signature with 401 and calls no door', async () => {
    const { deps: d } = deps([record({ verify: 'github', signingSecret: 'gh-secret-value' })]);
    const result = await deliverTriggerEvent(event({ headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` } }), d);
    expect(result).toEqual({ status: 401, body: { error: 'invalid signature' } });
    expect(d.sendMessage).not.toHaveBeenCalled();
    expect(d.pendingInputKinds).not.toHaveBeenCalled();
  });

  it('delivers a correctly signed GitHub event with source and event labels', async () => {
    const rawBody = Buffer.from('{"zen":"Keep it logically awesome."}');
    const signature = `sha256=${createHmac('sha256', 'gh-secret-value').update(rawBody).digest('hex')}`;
    const { deps: d } = deps([record({ verify: 'github', signingSecret: 'gh-secret-value' })]);
    const result = await deliverTriggerEvent(
      event({ rawBody, headers: { 'x-hub-signature-256': signature, 'x-github-event': 'ping', 'x-github-delivery': 'abc-123' } }),
      d,
    );
    expect(result).toEqual({ status: 202, body: { delivered: true, conversation: '20261101-0001' } });
    expect(d.sendMessage.mock.calls[0][1]).toContain('source=github event=ping delivery=abc-123');
  });

  it('refuses a Stripe trigger without a signing secret with 503', async () => {
    const { deps: d } = deps([record({ verify: 'stripe', signingSecret: null })]);
    expect(await deliverTriggerEvent(event(), d)).toEqual({ status: 503, body: { error: 'signing secret not set' } });
  });

  it('labels a verified Stripe event from the body type and id', async () => {
    const rawBody = Buffer.from('{"id":"evt_1","type":"payment_intent.succeeded"}');
    const { deps: d } = deps([record({ verify: 'stripe', signingSecret: 'whsec_test_secret' })]);
    const t = Math.floor(d.now() / 1000);
    const v1 = createHmac('sha256', 'whsec_test_secret').update(`${t}.${rawBody.toString()}`).digest('hex');
    const result = await deliverTriggerEvent(event({ rawBody, headers: { 'stripe-signature': `t=${t},v1=${v1}` } }), d);
    expect(result.status).toBe(202);
    expect(d.sendMessage.mock.calls[0][1]).toContain('source=stripe event=payment_intent.succeeded delivery=evt_1');
  });

  it('holds a message while the conversation has pending input', async () => {
    const { deps: d } = deps([record()], { pendingInputKinds: vi.fn(async () => ['askUserQuestion']) });
    const result = await deliverTriggerEvent(event(), d);
    expect(result).toEqual({ status: 503, body: { error: 'conversation is waiting for an operator answer' }, retryAfterSeconds: 300 });
    expect(d.sendMessage).not.toHaveBeenCalled();
  });

  it('answers 410 when the conversation is missing or the door says it ended', async () => {
    const missing = deps([record()], { pendingInputKinds: vi.fn(async () => null) });
    expect(await deliverTriggerEvent(event(), missing.deps)).toEqual({ status: 410, body: { error: 'target gone' } });
    expect(missing.deps.sendMessage).not.toHaveBeenCalled();

    const ended = deps([record()], { sendMessage: vi.fn(async () => ({ status: 422, body: { error: 'Conversation has ended' } })) });
    expect(await deliverTriggerEvent(event(), ended.deps)).toEqual({ status: 410, body: { error: 'target gone' } });
  });

  it("passes the door's error through as a 503 for other message failures", async () => {
    const { deps: d } = deps([record()], { sendMessage: vi.fn(async () => ({ status: 409, body: { error: 'pane not deliverable' } })) });
    expect(await deliverTriggerEvent(event(), d)).toEqual({ status: 503, body: { error: 'pane not deliverable' }, retryAfterSeconds: 300 });
  });

  it('starts a project conversation, passing harness only when the record sets it', async () => {
    const plain = deps([projectRecord()]);
    const started = await deliverTriggerEvent(event(), plain.deps);
    expect(started).toEqual({ status: 202, body: { started: true, conversation: '20261101-0042', id: 42 } });
    const body = plain.deps.startConversation.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('harness');
    expect(body).not.toHaveProperty('model');
    expect(body.projectKey).toBe('overdeck');
    expect(String(body.message).startsWith('An external webhook event')).toBe(true);
    expect(String(body.message)).toContain('\nLook at this.\n\n');

    _resetTriggerRateLimitsForTests();
    const withHarness = deps([projectRecord({ target: { kind: 'project', projectKey: 'overdeck', harness: 'codex', model: 'gpt-5' } })]);
    await deliverTriggerEvent(event(), withHarness.deps);
    expect(withHarness.deps.startConversation.mock.calls[0][0]).toMatchObject({ harness: 'codex', model: 'gpt-5' });
  });

  it('answers 410 when the create door rejects the project', async () => {
    const { deps: d } = deps([projectRecord()], {
      startConversation: vi.fn(async () => ({ status: 400, body: { error: 'Unknown project: overdeck' } })),
    });
    expect(await deliverTriggerEvent(event(), d)).toEqual({ status: 410, body: { error: 'target gone' } });
  });

  it('refuses the seventh project event in an hour and accepts one an hour later', async () => {
    const { deps: d, advance } = deps([projectRecord()]);
    for (let i = 0; i < 6; i++) {
      expect((await deliverTriggerEvent(event(), d)).status).toBe(202);
      advance(60_000);
    }
    expect(await deliverTriggerEvent(event(), d)).toEqual({ status: 429, body: { error: 'rate limit' }, retryAfterSeconds: 3600 });
    expect(d.startConversation).toHaveBeenCalledTimes(6);
    advance(HOUR - 6 * 60_000);
    expect((await deliverTriggerEvent(event(), d)).status).toBe(202);
  });

  it('does not spend rate-limit budget on 404 or 401 refusals', async () => {
    const rawBody = Buffer.from('{}');
    const signature = `sha256=${createHmac('sha256', 'gh-secret-value').update(rawBody).digest('hex')}`;
    const { deps: d } = deps([projectRecord({ verify: 'github', signingSecret: 'gh-secret-value' })]);
    for (let i = 0; i < 10; i++) {
      await deliverTriggerEvent(event({ urlSecret: 'b'.repeat(64) }), d);
      await deliverTriggerEvent(event({ rawBody, headers: { 'x-hub-signature-256': 'sha256=00' } }), d);
    }
    expect((await deliverTriggerEvent(event({ rawBody, headers: { 'x-hub-signature-256': signature } }), d)).status).toBe(202);
  });

  it('holds every event while the CPU is saturated', async () => {
    const { deps: d } = deps([projectRecord()], { cpuPressure: vi.fn(async () => ({ saturated: true })) });
    expect(await deliverTriggerEvent(event(), d)).toEqual({ status: 503, body: { error: 'host is CPU-saturated' }, retryAfterSeconds: 300 });
    expect(d.startConversation).not.toHaveBeenCalled();
  });

  it('logs the trigger id and outcome but never the body or secret', async () => {
    const { deps: d } = deps([record()]);
    await deliverTriggerEvent(event({ rawBody: Buffer.from('very-private-payload') }), d);
    expect(d.log).toHaveBeenCalledWith('[triggers] trg_000000000001 delivered 202');
    const logged = d.log.mock.calls.flat().join('\n');
    expect(logged).not.toContain('very-private-payload');
    expect(logged).not.toContain(URL_SECRET);
  });

  it('logs an id that is not shaped like a trigger id as -', async () => {
    const { deps: d } = deps([record()]);
    await deliverTriggerEvent(event({ triggerId: 'trg_x\n[triggers] forged line' }), d);
    expect(d.log).toHaveBeenCalledWith('[triggers] - not found 404');
  });

  it('lets only 6 of 7 concurrent project events through while the CPU check is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps: d } = deps([projectRecord()], {
      cpuPressure: vi.fn(async () => {
        await gate;
        return { saturated: false };
      }),
    });
    const pending = Array.from({ length: 7 }, () => deliverTriggerEvent(event(), d));
    await new Promise((resolve) => setImmediate(resolve));
    release();
    const statuses = (await Promise.all(pending)).map((result) => result.status).sort();
    expect(statuses).toEqual([202, 202, 202, 202, 202, 202, 429]);
    expect(d.startConversation).toHaveBeenCalledTimes(6);
  });

  it('does not spend rate-limit budget on a CPU hold', async () => {
    let saturated = true;
    const { deps: d } = deps([projectRecord()], { cpuPressure: vi.fn(async () => ({ saturated })) });
    for (let i = 0; i < 10; i++) expect((await deliverTriggerEvent(event(), d)).status).toBe(503);
    saturated = false;
    for (let i = 0; i < 6; i++) expect((await deliverTriggerEvent(event(), d)).status).toBe(202);
    expect((await deliverTriggerEvent(event(), d)).status).toBe(429);
  });
});
