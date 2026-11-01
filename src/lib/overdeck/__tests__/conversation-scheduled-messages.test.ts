/** PAN-4641 WI-4: the scheduled conversation messages door. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConversationLimitState } from '../conversation-usage-limit.js';

let testHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4641-scheduled-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

const NOW = Date.parse('2026-09-02T09:00:00.000Z');
const RESETS_AT = '2026-09-02T13:00:00.000Z';
const limited: ConversationLimitState = {
  limited: true, resetsAt: RESETS_AT, window: 'five_hour', source: 'quota-limits', errorAt: '2026-09-02T08:59:00.000Z',
};
const notLimited = async () => null;

async function setup(name = 'conv-a', harness: 'claude-code' | 'codex' = 'claude-code') {
  const { createConversation } = await import('../conversations.js');
  createConversation({ name, tmuxSession: name, cwd: testHome, harness });
  return import('../conversation-scheduled-messages.js');
}

describe('computeNotBefore', () => {
  it('uses the reset plus grace, a 15-minute fallback, or now', async () => {
    const { computeNotBefore, RESET_GRACE_MS, UNKNOWN_RESET_RETRY_MS } = await import('../conversation-scheduled-messages.js');
    expect(computeNotBefore(limited, NOW)).toEqual({ notBefore: Date.parse(RESETS_AT) + RESET_GRACE_MS, resetSource: 'quota-limits', limitWindow: 'five_hour' });
    expect(computeNotBefore({ ...limited, resetsAt: null, source: null, window: null }, NOW))
      .toEqual({ notBefore: NOW + UNKNOWN_RESET_RETRY_MS, resetSource: 'fallback', limitWindow: null });
    expect(computeNotBefore(null, NOW)).toEqual({ notBefore: NOW, resetSource: null, limitWindow: null });
    expect(computeNotBefore({ ...limited, limited: false }, NOW)).toEqual({ notBefore: NOW, resetSource: null, limitWindow: null });
  });
});

describe('scheduled messages store', () => {
  it('schedules rows and lists them in queue order', async () => {
    const store = await setup();
    const first = await store.scheduleConversationMessage('conv-a', 'first', { now: () => NOW, readUsageLimit: async () => limited });
    expect(first).toMatchObject({ status: 'scheduled', limit: limited, message: { text: 'first', status: 'pending', notBefore: '2026-09-02T13:01:00.000Z', resetSource: 'quota-limits', limitWindow: 'five_hour', attempts: 0 } });
    await store.scheduleConversationMessage('conv-a', 'second', { now: () => NOW + 1, readUsageLimit: notLimited });
    expect(store.listScheduledMessages('conv-a').map((m) => m.text)).toEqual(['first', 'second']);
    expect(store.headScheduledMessage('conv-a')?.text).toBe('first');
  });

  it('refuses each invalid input with its code', async () => {
    const store = await setup();
    await setup('conv-codex', 'codex');
    const deps = { now: () => NOW, readUsageLimit: notLimited };
    expect(await store.scheduleConversationMessage('missing', 'hi', deps)).toEqual({ status: 'not-found' });
    expect(await store.scheduleConversationMessage('conv-codex', 'hi', deps)).toMatchObject({ status: 'invalid', code: 'limit-detection-unsupported' });
    expect(await store.scheduleConversationMessage('conv-a', '   ', deps)).toMatchObject({ status: 'invalid', code: 'empty' });
    expect(await store.scheduleConversationMessage('conv-a', 42, deps)).toMatchObject({ status: 'invalid', code: 'empty' });
    expect(await store.scheduleConversationMessage('conv-a', 'x'.repeat(50_001), deps)).toMatchObject({ status: 'invalid', code: 'too-long' });
    expect(await store.scheduleConversationMessage('conv-a', '/pan status', deps)).toMatchObject({ status: 'invalid', code: 'command-not-schedulable' });
    expect(await store.scheduleConversationMessage('conv-a', '/panel is fine', deps)).toMatchObject({ status: 'scheduled' });
  });

  it('refuses a vault browse copy', async () => {
    const store = await setup();
    const { getOverdeckDatabase } = await import('../infra.js');
    getOverdeckDatabase().prepare(`UPDATE conversations SET origin = 'vault' WHERE name = ?`).run('conv-a');
    expect(await store.scheduleConversationMessage('conv-a', 'hi', { now: () => NOW, readUsageLimit: notLimited }))
      .toMatchObject({ status: 'invalid', code: 'vault-browse-copy' });
  });

  it('returns queue-full on the 21st undelivered row', async () => {
    const store = await setup();
    const deps = { now: () => NOW, readUsageLimit: notLimited };
    for (let i = 0; i < 20; i += 1) {
      expect((await store.scheduleConversationMessage('conv-a', `m${i}`, deps)).status).toBe('scheduled');
    }
    expect(await store.scheduleConversationMessage('conv-a', 'one too many', deps)).toEqual({ status: 'queue-full' });
  });

  it('claim is single-winner', async () => {
    const store = await setup();
    const result = await store.scheduleConversationMessage('conv-a', 'hi', { now: () => NOW, readUsageLimit: notLimited });
    if (result.status !== 'scheduled') throw new Error('unreachable');
    expect(store.claimScheduledMessage(result.message.id, NOW)).toBe(true);
    expect(store.claimScheduledMessage(result.message.id, NOW)).toBe(false);
  });

  it('edits only a pending row', async () => {
    const store = await setup();
    const result = await store.scheduleConversationMessage('conv-a', 'hi', { now: () => NOW, readUsageLimit: notLimited });
    if (result.status !== 'scheduled') throw new Error('unreachable');
    const id = result.message.id;
    expect(store.editScheduledMessage('conv-a', id, 'hello', NOW + 1)).toMatchObject({ status: 'saved', message: { text: 'hello' } });
    expect(store.editScheduledMessage('conv-a', id, '', NOW + 1)).toMatchObject({ status: 'invalid' });
    expect(store.editScheduledMessage('conv-a', 999, 'x', NOW + 1)).toEqual({ status: 'not-found' });
    store.claimScheduledMessage(id, NOW + 2);
    store.markScheduledSent(id, NOW + 3);
    expect(store.editScheduledMessage('conv-a', id, 'too late', NOW + 4)).toEqual({ status: 'not-editable' });
  });

  it('cancel removes a pending row and refuses a sent one', async () => {
    const store = await setup();
    const deps = { now: () => NOW, readUsageLimit: notLimited };
    const a = await store.scheduleConversationMessage('conv-a', 'a', deps);
    const b = await store.scheduleConversationMessage('conv-a', 'b', deps);
    if (a.status !== 'scheduled' || b.status !== 'scheduled') throw new Error('unreachable');
    expect(store.cancelScheduledMessage('conv-a', b.message.id)).toEqual({ status: 'removed' });
    expect(store.cancelScheduledMessage('conv-a', b.message.id)).toEqual({ status: 'not-found' });
    store.claimScheduledMessage(a.message.id, NOW);
    store.markScheduledSent(a.message.id, NOW);
    expect(store.cancelScheduledMessage('conv-a', a.message.id)).toEqual({ status: 'already-sent' });
    store.failScheduledMessage(a.message.id, NOW, 'unknown', 'delivery not confirmed');
    expect(store.cancelScheduledMessage('conv-a', a.message.id)).toEqual({ status: 'removed' });
  });

  it('re-arm counts attempts and fails on the 25th', async () => {
    const store = await setup();
    const result = await store.scheduleConversationMessage('conv-a', 'hi', { now: () => NOW, readUsageLimit: notLimited });
    if (result.status !== 'scheduled') throw new Error('unreachable');
    const next = store.computeNotBefore(limited, NOW);
    const uncounted = store.rearmScheduledMessage(result.message.id, NOW, next, { countAttempt: false });
    expect(uncounted).toMatchObject({ status: 'pending', attempts: 0, notBefore: '2026-09-02T13:01:00.000Z' });
    let message = uncounted;
    for (let i = 1; i <= store.MAX_SCHEDULED_ATTEMPTS; i += 1) {
      message = store.rearmScheduledMessage(result.message.id, NOW, next, { countAttempt: true });
      expect(message).toMatchObject({ status: 'pending', attempts: i });
    }
    message = store.rearmScheduledMessage(result.message.id, NOW, next, { countAttempt: true });
    expect(message).toMatchObject({ status: 'failed', lastError: 'gave up after 24 attempts' });
  });

  it('turns rows interrupted in sending into unknown', async () => {
    const store = await setup();
    const result = await store.scheduleConversationMessage('conv-a', 'hi', { now: () => NOW, readUsageLimit: notLimited });
    if (result.status !== 'scheduled') throw new Error('unreachable');
    store.claimScheduledMessage(result.message.id, NOW);
    expect(store.recoverInterruptedScheduledMessages(NOW + 1)).toBe(1);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'unknown', lastError: 'interrupted while sending' });
  });

  it('lists conversations with due work, skipping future and archived rows', async () => {
    const store = await setup();
    await setup('conv-b');
    await setup('conv-c');
    await store.scheduleConversationMessage('conv-a', 'due', { now: () => NOW, readUsageLimit: notLimited });
    await store.scheduleConversationMessage('conv-b', 'later', { now: () => NOW, readUsageLimit: async () => limited });
    await store.scheduleConversationMessage('conv-c', 'archived', { now: () => NOW, readUsageLimit: notLimited });
    const { getOverdeckDatabase } = await import('../infra.js');
    getOverdeckDatabase().prepare('UPDATE conversations SET archived_at = ? WHERE name = ?').run(NOW, 'conv-c');
    expect(store.listConversationsWithDueWork(NOW)).toEqual(['conv-a']);
    expect(store.listConversationsWithDueWork(Date.parse(RESETS_AT) + 60_000)).toEqual(['conv-a', 'conv-b']);
  });

  it('prunes delivered rows older than seven days', async () => {
    const store = await setup();
    const result = await store.scheduleConversationMessage('conv-a', 'hi', { now: () => NOW, readUsageLimit: notLimited });
    if (result.status !== 'scheduled') throw new Error('unreachable');
    store.markScheduledDelivered(result.message.id, NOW);
    expect(store.listScheduledMessages('conv-a')).toEqual([]);
    expect(store.listScheduledMessages('conv-a', { includeDelivered: true })).toHaveLength(1);
    expect(store.pruneDeliveredScheduledMessages(NOW + 6 * 24 * 60 * 60_000)).toBe(0);
    expect(store.pruneDeliveredScheduledMessages(NOW + 8 * 24 * 60 * 60_000)).toBe(1);
  });

  it('survives a database close and reopen', async () => {
    const store = await setup();
    await store.scheduleConversationMessage('conv-a', 'persist me', { now: () => NOW, readUsageLimit: notLimited });
    const { closeOverdeckDatabase } = await import('../infra.js');
    closeOverdeckDatabase();
    expect(store.listScheduledMessages('conv-a').map((m) => m.text)).toEqual(['persist me']);
  });

  it('deleting the conversation row cascades its scheduled messages', async () => {
    const store = await setup();
    await store.scheduleConversationMessage('conv-a', 'hi', { now: () => NOW, readUsageLimit: notLimited });
    const { getOverdeckDatabase } = await import('../infra.js');
    const db = getOverdeckDatabase();
    db.prepare('DELETE FROM conversations WHERE name = ?').run('conv-a');
    expect(db.prepare('SELECT COUNT(*) AS count FROM conversation_scheduled_messages').get<{ count: number }>()?.count).toBe(0);
  });
});
