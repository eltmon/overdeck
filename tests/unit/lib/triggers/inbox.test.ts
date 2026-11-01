/**
 * PAN-2356 WI-19: events the directory inbox held, sealed with the Worker's `sealTo`, are opened
 * and delivered through steps 2-6 of the trigger core. Stub delivery doors; a temp dedupe file.
 */
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryToMachineFrame, MachineToDirectoryFrame } from '@overdeck/contracts';

import { sealTo } from '../../../../services/connect/src/seal.ts';
import { InboxClient } from '../../../../src/dashboard/server/services/inbox-client.js';
import type { MachineKeyPair } from '../../../../src/lib/anywhere/machine-key.js';
import { _resetTriggerRateLimitsForTests, type TriggerDeliveryDeps } from '../../../../src/lib/triggers/deliver.js';
import { handleInboxEvent, InboxDedupe, type InboxEventFrame } from '../../../../src/lib/triggers/inbox.js';
import type { TriggerRecord } from '../../../../src/lib/triggers/store.js';

interface Sodium {
  crypto_box_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
}
const sodium = createRequire(import.meta.url)('sodium-native') as Sodium;

const keys: MachineKeyPair = { publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(32) };
sodium.crypto_box_seed_keypair(keys.publicKey, keys.secretKey, Buffer.alloc(32, 11));

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const INBOX = 'ib_0123456789abcdef';
const SECRET = 'whsec-test-signing-secret';

function trigger(verify: TriggerRecord['verify'] = 'github'): TriggerRecord {
  return {
    id: 'trg_0123456789ab',
    name: 'deploys',
    secretHash: '0'.repeat(64),
    target: { kind: 'conversation', conversation: 'ops' },
    template: null,
    verify,
    signingSecret: SECRET,
    createdAt: '2026-10-01T00:00:00.000Z',
    inbox: { id: INBOX, createdAt: '2026-10-01T00:00:00.000Z' },
  };
}

function seal(event: { eventId: string; receivedAt: number; headers: Record<string, string>; body: string }): InboxEventFrame {
  const plain = { v: 1, eventId: event.eventId, inboxId: INBOX, receivedAt: event.receivedAt, headers: event.headers, body: Buffer.from(event.body).toString('base64') };
  return { eventId: event.eventId, inboxId: INBOX, sealed: Buffer.from(sealTo(keys.publicKey, Buffer.from(JSON.stringify(plain)))).toString('base64') };
}

function githubEvent(eventId: string, receivedAt = NOW - 60_000): InboxEventFrame {
  const body = JSON.stringify({ action: 'opened', number: 7 });
  const signature = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  return seal({ eventId, receivedAt, headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': signature }, body });
}

let home = '';
let sent: Array<{ conversation: string; message: string }> = [];
let doorStatus = 200;

function deps(record: TriggerRecord = trigger()) {
  const delivery: TriggerDeliveryDeps = {
    readTriggers: async () => [record],
    now: () => NOW,
    cpuPressure: async () => ({ saturated: false }),
    pendingInputKinds: async () => [],
    sendMessage: async (conversation, message) => {
      sent.push({ conversation, message });
      return { status: doorStatus, body: doorStatus === 503 ? { error: 'busy' } : {} };
    },
    startConversation: async () => ({ status: 201, body: {} }),
    log: () => undefined,
  };
  return { keyPair: async () => keys, delivery, dedupe: new InboxDedupe(() => join(home, 'inbox-delivered.json')) };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-2356-inbox-'));
  sent = [];
  doorStatus = 200;
  _resetTriggerRateLimitsForTests();
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('inbox delivery (PAN-2356 WI-19)', () => {
  it('opens a sealed GitHub-signed event, delivers the envelope and acknowledges it', async () => {
    const directorySent: MachineToDirectoryFrame[] = [];
    const handlers: Array<(frame: DirectoryToMachineFrame) => void> = [];
    const client = new InboxClient(
      {
        send: (frame) => {
          directorySent.push(frame);
          return true;
        },
        on: (_type, handler) => {
          handlers.push(handler as (frame: DirectoryToMachineFrame) => void);
          return () => undefined;
        },
      },
      deps(),
    );
    client.start();
    const frame = githubEvent('00000000-0000-4000-8000-000000000001');
    handlers[0]!({ type: 'inbox-event', receivedAt: NOW - 60_000, ...frame });
    await client.idle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.conversation).toBe('ops');
    expect(sent[0]?.message).toContain('pull_request');
    expect(directorySent).toEqual([{ type: 'inbox-ack', eventId: frame.eventId }]);
  });

  it('delivers one event id once and acknowledges it every time', async () => {
    const d = deps();
    const frame = githubEvent('00000000-0000-4000-8000-000000000002');
    expect(await handleInboxEvent(frame, d)).toEqual({ kind: 'ack' });
    expect(await handleInboxEvent(frame, d)).toEqual({ kind: 'ack' });
    expect(sent).toHaveLength(1);
    // The dedupe survives a restart: a fresh store reads the file.
    expect(await handleInboxEvent(frame, { ...d, dedupe: new InboxDedupe(() => join(home, 'inbox-delivered.json')) })).toEqual({ kind: 'ack' });
    expect(sent).toHaveLength(1);
  });

  it('verifies a Stripe signature 3 hours old against when the directory received it', async () => {
    const receivedAt = NOW - 3 * 3_600_000;
    const timestamp = Math.floor(receivedAt / 1000) - 30;
    const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const v1 = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
    const frame = seal({ eventId: '00000000-0000-4000-8000-000000000003', receivedAt, headers: { 'stripe-signature': `t=${timestamp},v1=${v1}` }, body });
    expect(await handleInboxEvent(frame, deps(trigger('stripe')))).toEqual({ kind: 'ack' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toContain('invoice.paid');
  });

  it('nacks with retryAfterSeconds 300 when the delivery door answers 503', async () => {
    doorStatus = 503;
    expect(await handleInboxEvent(githubEvent('00000000-0000-4000-8000-000000000004'), deps())).toEqual({ kind: 'nack', retryAfterSeconds: 300 });
  });

  it('refuses and acknowledges an event received 25 hours ago', async () => {
    const log = vi.fn();
    const d = deps();
    d.delivery.log = log;
    expect(await handleInboxEvent(githubEvent('00000000-0000-4000-8000-000000000005', NOW - 25 * 3_600_000), d)).toEqual({ kind: 'ack' });
    expect(sent).toEqual([]);
    expect(log).toHaveBeenCalledWith(`[triggers] inbox ${INBOX} stale 410`);
  });

  it('acknowledges an unreadable event and one for an unknown inbox, logging no body', async () => {
    const log = vi.fn();
    const d = deps({ ...trigger(), inbox: null });
    d.delivery.log = log;
    const frame = githubEvent('00000000-0000-4000-8000-000000000006');
    expect(await handleInboxEvent({ ...frame, sealed: Buffer.from('not sealed').toString('base64') }, d)).toEqual({ kind: 'ack' });
    expect(await handleInboxEvent(frame, d)).toEqual({ kind: 'ack' });
    expect(log.mock.calls.map((call) => call[0])).toEqual([`[triggers] inbox ${INBOX} unreadable`, `[triggers] inbox ${INBOX} not found 404`]);
    expect(sent).toEqual([]);
  });
});
