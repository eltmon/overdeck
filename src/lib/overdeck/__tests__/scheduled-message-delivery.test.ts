/**
 * PAN-4641 WI-6 — the scheduled-messages tick. The door runs on a real temp
 * database; transcript reads, liveness, resume, pane and delivery are injected.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationLimitState, DeliveryOutcome } from '../conversation-usage-limit.js';
import type { DoorResponse, ScheduledDeliveryDeps } from '../scheduled-message-delivery.js';

// The tick's default doors pull in the whole conversation runtime; every test injects them.
vi.mock('../conversation-message.js', () => ({ handleConversationMessage: vi.fn() }));
vi.mock('../conversation-runtime.js', () => ({ handleConversationResume: vi.fn() }));
vi.mock('../conversation-reads.js', () => ({ resolveSessionFile: async () => null }));
// The default choice-menu check reads the pane through the backend-aware door (Herdr or tmux).
const paneIo = vi.hoisted(() => ({ text: '', reads: [] as string[] }));
vi.mock('../../terminal-backends/agent-pane-io.js', () => ({
  resolveAgentPaneIo: async (session: string) => {
    paneIo.reads.push(session);
    return { backend: 'herdr', read: async () => paneIo.text, sendKey: async () => undefined };
  },
}));

const RESUME_GATE_MENU = [
  'Resuming the full session will consume a substantial portion of your usage limits.',
  '',
  '❯ 1. Resume from summary (recommended)',
  '  2. Resume full session as-is',
  "  3. Don't ask me again",
  '',
  'Enter to confirm · Esc to cancel',
].join('\n');

let testHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  paneIo.text = '';
  paneIo.reads.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-02T09:00:00.000Z'));
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4641-tick-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  vi.useRealTimers();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

const RESETS_AT = '2026-09-02T13:00:00.000Z';
const DUE_AT = Date.parse(RESETS_AT) + 60_000;
const limitedState: ConversationLimitState = {
  limited: true, resetsAt: RESETS_AT, window: 'five_hour', source: 'quota-limits', errorAt: '2026-09-02T08:59:00.000Z',
};

interface Harness {
  deps: ScheduledDeliveryDeps;
  delivered: string[];
  setLimit(limit: ConversationLimitState | null): void;
  setOutcome(outcome: DeliveryOutcome): void;
  setDeliver(answer: DoorResponse | Error): void;
  setResume(answer: DoorResponse): void;
  setAlive(alive: boolean): void;
  setBlocked(blocked: boolean): void;
  resumed: string[];
  emit: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  let limit: ConversationLimitState | null = null;
  let outcome: DeliveryOutcome = { kind: 'waiting' };
  let deliverAnswer: DoorResponse | Error = { status: 200, body: { ok: true } };
  let resumeAnswer: DoorResponse = { status: 200, body: {} };
  let alive = true;
  let blocked = false;
  const delivered: string[] = [];
  const resumed: string[] = [];
  const emit = vi.fn();
  return {
    delivered,
    resumed,
    emit,
    setLimit: (next) => { limit = next; },
    setOutcome: (next) => { outcome = next; },
    setDeliver: (next) => { deliverAnswer = next; },
    setResume: (next) => { resumeAnswer = next; },
    setAlive: (next) => { alive = next; },
    setBlocked: (next) => { blocked = next; },
    deps: {
      now: () => Date.now(),
      readUsageLimit: async () => limit,
      readOutcome: async () => outcome,
      harnessAlive: async () => alive,
      resume: async (name) => { resumed.push(name); return resumeAnswer; },
      paneBlocked: async () => blocked,
      deliver: async (_name, text) => {
        if (deliverAnswer instanceof Error) throw deliverAnswer;
        delivered.push(text);
        return deliverAnswer;
      },
      emit,
      log: () => {},
    },
  };
}

async function setup(name = 'conv-a') {
  const { createConversation } = await import('../conversations.js');
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: testHome, harness: 'claude-code' });
  const store = await import('../conversation-scheduled-messages.js');
  const tick = await import('../scheduled-message-delivery.js');
  return { store, tick };
}

async function schedule(text: string, limit: ConversationLimitState | null = limitedState, name = 'conv-a') {
  const { scheduleConversationMessage } = await import('../conversation-scheduled-messages.js');
  const result = await scheduleConversationMessage(name, text, { now: () => Date.now(), readUsageLimit: async () => limit });
  if (result.status !== 'scheduled') throw new Error(`schedule failed: ${result.status}`);
  return result.message;
}

async function advanceTo(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms - Date.now());
}

describe('tickScheduledMessages', () => {
  it('does not deliver before not_before and delivers on the first tick after it', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('continue');
    await tick.tickScheduledMessages(h.deps);
    await advanceTo(DUE_AT - 1_000);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual([]);

    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual(['continue']);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'sent' });
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', source: 'dashboard', link: expect.stringMatching(/^\/conv\/\d+$/) }));
  });

  it('delivers in queue order, one row at a time, after the outcome confirms', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('first');
    await schedule('second');
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual(['first']);

    await advanceTo(DUE_AT + 60_000);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual(['first']);

    h.setOutcome({ kind: 'confirmed' });
    await advanceTo(DUE_AT + 120_000);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual(['first']);
    expect(store.listScheduledMessages('conv-a').map((m) => m.text)).toEqual(['second']);

    h.setOutcome({ kind: 'waiting' });
    await advanceTo(DUE_AT + 180_000);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual(['first', 'second']);
  });

  it('re-arms a sent row that hits the limit again', async () => {
    const { tick, store } = await setup();
    const h = harness();
    const message = await schedule('continue');
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);

    const nextReset = '2026-09-02T18:00:00.000Z';
    h.setOutcome({ kind: 'limited-again', usageLimit: { resetsAt: nextReset, window: 'five_hour', source: 'quota-limits' } });
    await advanceTo(DUE_AT + 60_000);
    await tick.tickScheduledMessages(h.deps);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({
      id: message.id, status: 'pending', attempts: 1, notBefore: '2026-09-02T18:01:00.000Z',
    });
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));

    h.setOutcome({ kind: 'waiting' });
    await advanceTo(Date.parse('2026-09-02T18:00:30.000Z'));
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual(['continue']);

    await advanceTo(Date.parse('2026-09-02T18:01:00.000Z'));
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual(['continue', 'continue']);
  });

  it('re-arms without an attempt when still limited at due time', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('continue');
    h.setLimit({ ...limitedState, resetsAt: '2026-09-02T15:00:00.000Z' });
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual([]);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'pending', attempts: 0, notBefore: '2026-09-02T15:01:00.000Z' });
  });

  it('never delivers a cancelled row', async () => {
    const { tick, store } = await setup();
    const h = harness();
    const message = await schedule('never');
    expect(store.cancelScheduledMessage('conv-a', message.id)).toEqual({ status: 'removed' });
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual([]);
  });

  it('delivers a row scheduled before a database close and reopen', async () => {
    const { tick } = await setup();
    const h = harness();
    await schedule('after restart');
    const { closeOverdeckDatabase } = await import('../infra.js');
    closeOverdeckDatabase();
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual(['after restart']);
  });

  it('resumes an ended conversation before delivering, and backs off when resume fails', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('continue');
    const { markConversationEnded } = await import('../conversations.js');
    markConversationEnded('conv-a');
    h.setResume({ status: 500, body: { error: 'spawn failed' } });
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(h.resumed).toEqual(['conv-a']);
    expect(h.delivered).toEqual([]);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'pending', lastError: 'resume failed: spawn failed' });

    h.setResume({ status: 200, body: {} });
    await advanceTo(DUE_AT + 60_000);
    await tick.tickScheduledMessages(h.deps);
    expect(h.resumed).toEqual(['conv-a', 'conv-a']);
    expect(h.delivered).toEqual(['continue']);
  });

  it('resumes when the harness process is gone', async () => {
    const { tick } = await setup();
    const h = harness();
    await schedule('continue');
    h.setAlive(false);
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(h.resumed).toEqual(['conv-a']);
    expect(h.delivered).toEqual(['continue']);
  });

  it('defers while a choice menu is open', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('continue');
    h.setBlocked(true);
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual([]);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'pending', lastError: expect.stringContaining('choice menu') });
  });

  it('maps the delivery door answer: 409 pending, 422 failed and blocks the queue', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('first');
    await schedule('second');
    h.setDeliver({ status: 409, body: { error: 'busy' } });
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ text: 'first', status: 'pending', lastError: 'busy' });

    h.setDeliver({ status: 422, body: { error: 'Session has ended' } });
    await advanceTo(DUE_AT + 60_000);
    await tick.tickScheduledMessages(h.deps);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ text: 'first', status: 'failed', lastError: 'Session has ended' });

    h.setDeliver({ status: 200, body: {} });
    await advanceTo(DUE_AT + 120_000);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered.filter((text) => text === 'second')).toEqual([]);
  });

  it('marks a 502 or a thrown delivery unknown and never re-pastes it', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('first');
    h.setDeliver({ status: 502, body: { error: 'Delivery could not be confirmed' } });
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'unknown', lastError: 'Delivery could not be confirmed' });

    await setup('conv-b');
    await schedule('other', limitedState, 'conv-b');
    h.setDeliver(new Error('paste exploded'));
    await advanceTo(DUE_AT + 60_000);
    await tick.tickScheduledMessages(h.deps);
    expect(store.headScheduledMessage('conv-b')).toMatchObject({ status: 'unknown', lastError: 'paste exploded' });

    // The 502 attempt reached the door once; the thrown one never recorded a paste.
    expect(h.delivered).toEqual(['first']);
    h.setDeliver({ status: 200, body: {} });
    await advanceTo(DUE_AT + 120_000);
    await tick.tickScheduledMessages(h.deps);
    expect(h.delivered).toEqual(['first']);
  });

  it('marks a sent row delivered after the outcome window without confirmation', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('continue');
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    await advanceTo(DUE_AT + tick.OUTCOME_WINDOW_MS);
    await tick.tickScheduledMessages(h.deps);
    expect(store.listScheduledMessages('conv-a')).toEqual([]);
    expect(store.listScheduledMessages('conv-a', { includeDelivered: true })[0]).toMatchObject({ status: 'delivered', lastError: 'no transcript confirmation' });
  });
});

describe('tickScheduledMessages review hardening', () => {
  it('reads the pane through the backend-aware door and defers on a choice menu', async () => {
    const { tick, store } = await setup();
    const h = harness();
    const { paneBlocked: _unused, ...deps } = h.deps;
    await schedule('continue');
    paneIo.text = RESUME_GATE_MENU;
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(deps);
    expect(paneIo.reads).toEqual(['conv-conv-a']);
    expect(h.delivered).toEqual([]);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'pending', lastError: expect.stringContaining('choice menu') });

    paneIo.text = 'ready for input';
    await advanceTo(DUE_AT + 60_000);
    await tick.tickScheduledMessages(deps);
    expect(h.delivered).toEqual(['continue']);
  });

  it('retries a 5xx the door marks as not delivered, counting the attempt', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('continue');
    h.setDeliver({ status: 502, body: { error: 'Not delivered: menu open', code: 'not-delivered', deliveryUnknown: false, retryable: true } });
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages(h.deps);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'pending', attempts: 1, lastError: 'Not delivered: menu open' });

    h.setDeliver({ status: 200, body: {} });
    await advanceTo(DUE_AT + 60_000);
    await tick.tickScheduledMessages(h.deps);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'sent' });
  });

  it('gives up on a conversation whose resume keeps failing, with a warn entry', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('continue');
    const { markConversationEnded } = await import('../conversations.js');
    markConversationEnded('conv-a');
    h.setResume({ status: 500, body: { error: 'spawn failed' } });
    for (let i = 0; i <= store.MAX_SCHEDULED_ATTEMPTS; i += 1) {
      await advanceTo(DUE_AT + i * 60_000);
      await tick.tickScheduledMessages(h.deps);
    }
    expect(h.resumed).toHaveLength(store.MAX_SCHEDULED_ATTEMPTS + 1);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'failed', lastError: 'gave up after 24 attempts' });
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', message: expect.stringContaining('resume failed: spawn failed') }));
  });

  it('puts a claimed row back to pending when a check throws before the paste', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('continue');
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages({ ...h.deps, harnessAlive: async () => { throw new Error('backend unavailable'); } });
    expect(h.delivered).toEqual([]);
    expect(store.headScheduledMessage('conv-a')).toMatchObject({ status: 'pending', lastError: 'backend unavailable' });
  });

  it('marks a claimed row unknown when a write throws after the paste', async () => {
    const { tick, store } = await setup();
    const h = harness();
    await schedule('continue');
    await advanceTo(DUE_AT);
    await tick.tickScheduledMessages({ ...h.deps, emit: vi.fn(() => { throw new Error('event store down'); }) });
    expect(h.delivered).toEqual(['continue']);
    expect(store.headScheduledMessage('conv-a')?.status).not.toBe('sending');
  });
});

describe('decodeDoorResponse', () => {
  it('reads the status and JSON body of a real jsonResponse', async () => {
    const { jsonResponse } = await import('../../../dashboard/server/http-helpers.js');
    const { decodeDoorResponse } = await import('../scheduled-message-delivery.js');
    expect(decodeDoorResponse(jsonResponse({ code: 'x' }, { status: 409 }))).toEqual({ status: 409, body: { code: 'x' } });
  });
});
