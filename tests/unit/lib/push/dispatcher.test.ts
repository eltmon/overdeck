import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPushConfig, type NormalizedPushConfig } from '../../../../src/lib/config-yaml/push-config.js';
import type { PendingItem } from '../../../../src/lib/push/classify.js';
import { createNeedsYouDispatcher } from '../../../../src/lib/push/dispatcher.js';
import type { NeedsYouNotification, PushProvider } from '../../../../src/lib/push/types.js';

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
