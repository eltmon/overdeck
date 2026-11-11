import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPushConfig, type NormalizedPushConfig } from '../../../../src/lib/config-yaml/push-config.js';
import type { PendingItem } from '../../../../src/lib/push/classify.js';
import { createNeedsYouDispatcher, RESOLVE_GRACE_MS } from '../../../../src/lib/push/dispatcher.js';
import type {
  NeedsYouNotification,
  PushHistorySink,
  PushProvider,
  PushResolutionRecord,
  PushSentRecord,
} from '../../../../src/lib/push/types.js';

const START = Date.parse('2026-11-01T12:00:00.000Z');

function recordingProvider(): PushProvider & { sent: NeedsYouNotification[] } {
  const sent: NeedsYouNotification[] = [];
  return {
    name: 'fake',
    sent,
    hasTargets: async () => true,
    send: async (n) => {
      sent.push(n);
      return [{ target: 'fake:1', ok: true }];
    },
  };
}

function item(key: string, overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    subject: 'agent:a',
    key,
    kind: key.startsWith('auq:') ? 'question' : 'approval',
    category: key.startsWith('auq:') ? 'question' : key.startsWith('plan:') ? 'plan' : 'permission',
    askedAt: new Date(START).toISOString(),
    issueId: 'PAN-1',
    label: 'PAN-1 work',
    url: '/m?subject=a',
    preview: null,
    ...overrides,
  };
}

function setup(config: Partial<NormalizedPushConfig> = {}, providers?: PushProvider[]) {
  const provider = recordingProvider();
  const dispatcher = createNeedsYouDispatcher({
    providers: providers ?? [provider],
    readConfig: () => ({ ...defaultPushConfig(), ...config }),
    startedAt: START,
  });
  return { provider, dispatcher };
}

describe('needs-you dispatcher (PAN-2354)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the same key once when observed twice', () => {
    const { provider, dispatcher } = setup();
    dispatcher.observeSubject('agent:a', [item('auq:1')]);
    dispatcher.observeSubject('agent:a', [item('auq:1')]);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toMatchObject({ kind: 'question', tag: 'auq:1', title: 'Question · PAN-1 work' });
  });

  it('sends an auq key once across an agent subject and a conversation subject', () => {
    const { provider, dispatcher } = setup();
    dispatcher.observeSubject('agent:conv-x', [item('auq:9')]);
    dispatcher.observeSubject('conv:x', [item('auq:9', { subject: 'conv:x' })]);
    expect(provider.sent).toHaveLength(1);
  });

  it('keeps per-subject perm:pending keys independent', () => {
    const { provider, dispatcher } = setup();
    dispatcher.observeSubject('agent:a', [item('perm:pending')]);
    dispatcher.observeSubject('agent:b', [item('perm:pending', { subject: 'agent:b' })]);
    expect(provider.sent).toHaveLength(2);
  });

  it('has no targets when push is disabled', async () => {
    expect(await setup({ enabled: false }).dispatcher.hasTargets()).toBe(false);
    expect(await setup().dispatcher.hasTargets()).toBe(true);
  });

  it('sends again when a key is removed then re-added', () => {
    const { provider, dispatcher } = setup();
    dispatcher.observeSubject('agent:a', [item('auq:1')]);
    dispatcher.observeSubject('agent:a', []);
    dispatcher.observeSubject('agent:a', [item('auq:1')]);
    expect(provider.sent).toHaveLength(2);
  });

  it('primes silently on items asked well before start, and sends newer ones', () => {
    const { provider, dispatcher } = setup();
    dispatcher.observeSubject('agent:a', [item('auq:old', { askedAt: new Date(START - 5 * 60_000).toISOString() })]);
    expect(provider.sent).toHaveLength(0);
    dispatcher.observeSubject('agent:a', [
      item('auq:old', { askedAt: new Date(START - 5 * 60_000).toISOString() }),
      item('auq:new', { askedAt: new Date(START + 1_000).toISOString() }),
    ]);
    expect(provider.sent.map(n => n.tag)).toEqual(['auq:new']);
  });

  it('filters by the configured events', () => {
    const { provider, dispatcher } = setup({ events: ['question'] });
    dispatcher.observeSubject('agent:a', [item('plan:1')]);
    expect(provider.sent).toHaveLength(0);
    dispatcher.observeSubject('agent:a', [item('plan:1'), item('auq:2')]);
    expect(provider.sent.map(n => n.kind)).toEqual(['question']);
  });

  it('sends nothing when disabled', () => {
    const { provider, dispatcher } = setup({ enabled: false });
    dispatcher.observeSubject('agent:a', [item('auq:1')]);
    dispatcher.observeEdge({ kind: 'failed', category: 'failed', tag: 'journal:x', title: 't', publicTitle: 'p', body: 'b', url: '/m', issueId: null });
    expect(provider.sent).toHaveLength(0);
  });

  it('limits to 6 per minute and sends one summary for the rest', async () => {
    const { provider, dispatcher } = setup();
    for (let i = 0; i < 8; i++) {
      dispatcher.observeSubject(`agent:${i}`, [item(`auq:${i}`, { subject: `agent:${i}` })]);
      await vi.advanceTimersByTimeAsync(1_250);
    }
    expect(provider.sent).toHaveLength(6);
    expect(dispatcher.stats().rateLimited).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.sent).toHaveLength(7);
    expect(provider.sent[6]).toMatchObject({ kind: 'summary', title: '2 more items need you', url: '/m', tag: 'summary' });
    dispatcher.dispose();
  });

  it('dedups edge notifications by tag', () => {
    const { provider, dispatcher } = setup();
    const edge = { kind: 'failed' as const, category: 'failed' as const, tag: 'journal:PAN-1:merge.failed:t', title: 't', publicTitle: 'p', body: 'b', url: '/m', issueId: 'PAN-1' };
    dispatcher.observeEdge(edge);
    dispatcher.observeEdge(edge);
    expect(provider.sent).toHaveLength(1);
  });

  it('contains a provider that rejects and records lastError', async () => {
    const failing: PushProvider = { name: 'broken', hasTargets: async () => true, send: async () => { throw new Error('boom'); } };
    const { dispatcher } = setup({}, [failing]);
    expect(() => dispatcher.observeSubject('agent:a', [item('auq:1')])).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatcher.stats().lastError).toContain('boom');
    expect(dispatcher.stats().byProvider['broken']).toEqual({ ok: 0, failed: 1 });
  });
});

function fakeSink(open: Record<string, { id: string; ts: string }> = {}): PushHistorySink & {
  sent: PushSentRecord[];
  resolved: PushResolutionRecord[];
} {
  const sent: PushSentRecord[] = [];
  const resolved: PushResolutionRecord[] = [];
  return {
    sent,
    resolved,
    recordSent: (record) => sent.push(record),
    recordResolution: (record) => resolved.push(record),
    openEntryIdFor: (_subject, key) => open[key] ?? null,
  };
}

function historySetup(opts: {
  config?: Partial<NormalizedPushConfig>;
  providers?: PushProvider[];
  open?: Record<string, { id: string; ts: string }>;
  answers?: Array<{ key: string; at: number }>;
} = {}) {
  const provider = recordingProvider();
  const history = fakeSink(opts.open);
  const answers = opts.answers ?? [];
  let counter = 0;
  const dispatcher = createNeedsYouDispatcher({
    providers: opts.providers ?? [provider],
    readConfig: () => ({ ...defaultPushConfig(), ...opts.config }),
    startedAt: START,
    history,
    wasAnswered: (key, from, to) => answers.some((a) => a.key === key && a.at >= from && a.at <= to),
    newId: () => `id-${++counter}`,
  });
  return { provider, history, answers, dispatcher };
}

/** Lets fan-out promises settle under fake timers. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('needs-you dispatcher push history (PAN-5111)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a delivered push with one delivery per outcome and no rejection text', async () => {
    const twoTargets: PushProvider = {
      name: 'webpush',
      hasTargets: async () => true,
      send: async () => [
        { target: 'sub-1', ok: true },
        { target: 'sub-2', ok: false, reason: 'rejected', status: 401, detail: 'token=SENTINEL-SECRET' },
      ],
    };
    const failing: PushProvider = {
      name: 'ntfy',
      hasTargets: async () => true,
      send: async () => {
        throw new Error('POST https://ntfy.example/x?auth=SENTINEL-SECRET failed');
      },
    };
    const { history, dispatcher } = historySetup({ providers: [twoTargets, failing] });
    dispatcher.observeSubject('conv:c1', [item('auq:1', { subject: 'conv:c1' })]);
    await settle();

    expect(history.sent).toHaveLength(1);
    expect(history.sent[0]).toMatchObject({ id: 'id-1', key: 'auq:1', subject: 'conv:c1', kind: 'question' });
    expect(history.sent[0]!.deliveries).toEqual([
      { provider: 'webpush', target: 'sub-1', ok: true },
      { provider: 'webpush', target: 'sub-2', ok: false, reason: 'rejected', status: 401 },
      { provider: 'ntfy', target: 'ntfy', ok: false, reason: 'error' },
    ]);
    expect(JSON.stringify(history.sent)).not.toContain('SENTINEL-SECRET');
    expect(dispatcher.stats().lastError).toContain('SENTINEL-SECRET');
  });

  it('records nothing for primed, filtered, rate-limited and no-target pushes', async () => {
    const primedRun = historySetup();
    primedRun.dispatcher.observeSubject('agent:a', [item('auq:old', { askedAt: new Date(START - 120_000).toISOString() })]);

    const filteredRun = historySetup({ config: { events: ['finished'] } });
    filteredRun.dispatcher.observeSubject('agent:a', [item('auq:1')]);

    const limitedRun = historySetup();
    limitedRun.dispatcher.observeSubject('agent:a', Array.from({ length: 7 }, (_, i) => item(`auq:${i}`)));

    const empty: PushProvider = { name: 'none', hasTargets: async () => false, send: async () => [] };
    const noTargetRun = historySetup({ providers: [empty] });
    noTargetRun.dispatcher.observeSubject('agent:a', [item('auq:1')]);
    await settle();

    expect(primedRun.history.sent).toHaveLength(0);
    expect(filteredRun.history.sent).toHaveLength(0);
    expect(limitedRun.history.sent.map((r) => r.key)).toEqual(['auq:0', 'auq:1', 'auq:2', 'auq:3', 'auq:4', 'auq:5']);
    expect(noTargetRun.history.sent).toHaveLength(0);
    expect(noTargetRun.dispatcher.trackedIds().size).toBe(0);
    noTargetRun.dispatcher.observeSubject('agent:a', []);
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS);
    expect(noTargetRun.history.resolved).toHaveLength(0);
  });

  it('resolves an auq key owned by two subjects once, after both drop it and the grace passes', async () => {
    const { history, dispatcher } = historySetup();
    dispatcher.observeSubject('agent:conv-x', [item('auq:9')]);
    dispatcher.observeSubject('conv:x', [item('auq:9', { subject: 'conv:x' })]);
    await settle();

    dispatcher.observeSubject('agent:conv-x', []);
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS * 2);
    expect(history.resolved).toHaveLength(0);
    expect(dispatcher.isPending('agent:other', 'auq:9')).toBe(true);

    dispatcher.observeSubject('conv:x', []);
    expect(dispatcher.trackedIds().has('id-1')).toBe(true);
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS - 1);
    expect(history.resolved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(history.resolved).toEqual([{ id: 'id-1', ts: expect.any(String), outcome: 'resolved-without-answer' }]);
    expect(dispatcher.trackedIds().size).toBe(0);
  });

  it('resolves answered when an answer note falls inside the window', async () => {
    const { history, answers, dispatcher } = historySetup();
    dispatcher.observeSubject('agent:a', [item('auq:1')]);
    await vi.advanceTimersByTimeAsync(1000);
    dispatcher.observeSubject('agent:a', []);
    // The answer door writes its note after the transcript cleared, inside the grace.
    answers.push({ key: 'auq:1', at: Date.now() + 2000 });
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS);
    expect(history.resolved.map((r) => r.outcome)).toEqual(['answered']);
  });

  it('resolves without an answer when no note exists', async () => {
    const { history, dispatcher } = historySetup();
    dispatcher.observeSubject('agent:a', [item('plan:1')]);
    dispatcher.observeSubject('agent:a', []);
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS);
    expect(history.resolved.map((r) => r.outcome)).toEqual(['resolved-without-answer']);
  });

  it('closes the first window when the same key is pushed again', async () => {
    const { history, answers, dispatcher } = historySetup();
    dispatcher.observeSubject('agent:a', [item('auq:1')]);
    await vi.advanceTimersByTimeAsync(1000);
    dispatcher.observeSubject('agent:a', []);
    await vi.advanceTimersByTimeAsync(1000);
    dispatcher.observeSubject('agent:a', [item('auq:1')]);
    await vi.advanceTimersByTimeAsync(1000);
    answers.push({ key: 'auq:1', at: Date.now() });
    await vi.advanceTimersByTimeAsync(1000);
    dispatcher.observeSubject('agent:a', []);
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS * 2);

    expect(history.sent.map((r) => r.id)).toEqual(['id-1', 'id-2']);
    expect(history.resolved.map((r) => [r.id, r.outcome])).toEqual([
      ['id-1', 'resolved-without-answer'],
      ['id-2', 'answered'],
    ]);
  });

  it('adopts the open history entry of a primed key and resolves it on departure', async () => {
    const open = { 'auq:old': { id: 'before-restart', ts: new Date(START - 300_000).toISOString() } };
    const { provider, history, dispatcher } = historySetup({ open });
    dispatcher.observeSubject('conv:c1', [item('auq:old', { subject: 'conv:c1', askedAt: new Date(START - 300_000).toISOString() })]);
    expect(provider.sent).toHaveLength(0);
    expect(dispatcher.trackedIds().has('before-restart')).toBe(true);
    expect(dispatcher.tracksConversations()).toBe(true);

    dispatcher.observeSubject('conv:c1', []);
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS);
    expect(history.resolved.map((r) => r.id)).toEqual(['before-restart']);
  });

  it('records departures but pushes nothing new with notify: false', async () => {
    const { provider, history, dispatcher } = historySetup();
    dispatcher.observeSubject('conv:c1', [item('auq:1', { subject: 'conv:c1' })]);
    await settle();
    dispatcher.observeSubject('conv:c1', [item('auq:2', { subject: 'conv:c1' })], { notify: false });
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS);

    expect(provider.sent.map((n) => n.tag)).toEqual(['auq:1']);
    expect(history.resolved.map((r) => r.id)).toEqual(['id-1']);
    expect(dispatcher.isPending('conv:c1', 'auq:2')).toBe(false);

    // Once a target exists again, the unregistered key pushes as a new item.
    dispatcher.observeSubject('conv:c1', [item('auq:2', { subject: 'conv:c1' })]);
    expect(provider.sent.map((n) => n.tag)).toEqual(['auq:1', 'auq:2']);
  });

  it('records pending resolutions at once on dispose', async () => {
    const { history, dispatcher } = historySetup();
    dispatcher.observeSubject('agent:a', [item('perm:pending')]);
    await settle();
    dispatcher.observeSubject('agent:a', []);
    expect(history.resolved).toHaveLength(0);
    dispatcher.dispose();
    expect(history.resolved.map((r) => [r.id, r.outcome])).toEqual([['id-1', 'resolved-without-answer']]);
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS);
    expect(history.resolved).toHaveLength(1);
  });

  it('records edge pushes and sendNow with subject null and never resolves them', async () => {
    const { history, dispatcher } = historySetup();
    dispatcher.observeEdge({
      kind: 'finished',
      category: 'finished',
      tag: 'journal:1',
      title: 'Done',
      publicTitle: 'Done',
      body: 'x',
      url: '/m',
      issueId: null,
    } as Parameters<typeof dispatcher.observeEdge>[0]);
    await dispatcher.sendNow({
      kind: 'test',
      category: 'test',
      tag: 'test',
      title: 'Test',
      publicTitle: 'Test',
      body: 'x',
      url: '/m',
      issueId: null,
      ts: new Date(START).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(RESOLVE_GRACE_MS * 2);

    expect(history.sent.map((r) => [r.key, r.subject])).toEqual([
      ['journal:1', null],
      ['test', null],
    ]);
    expect(history.resolved).toHaveLength(0);
    expect(dispatcher.trackedIds().size).toBe(0);
  });
});
