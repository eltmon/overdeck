import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { phoneIssueSheetPath } from '@overdeck/contracts';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../agent-enrichment-service.js', () => ({ pollEnrichmentNow: vi.fn() }));
vi.mock('../../../../lib/config-yaml.js', async () => {
  const { defaultPushConfig } = await import('../../../../lib/config-yaml/push-config.js');
  return { loadConfigSync: () => ({ config: { push: defaultPushConfig() } }) };
});

const { pollEnrichmentNow } = await import('../agent-enrichment-service.js');
const {
  getPushHistoryView,
  startNeedsYouPushService,
  stopNeedsYouPushService,
  wakeNeedsYouPush,
} = await import('../needs-you-push-service.js');

import type { MachineToDirectoryFrame } from '@overdeck/contracts';
import type { MachineKeyPair } from '../../../../lib/anywhere/machine-key.js';
import { openSealed } from '../../../../lib/anywhere/sealed-box.js';
import { createNativePushProvider, type PushDirectoryPort } from '../../../../lib/push/native-provider.js';
import { noteOperatorAnswer, resetOperatorAnswers } from '../../../../lib/push/operator-answers.js';
import { createPushHistory, getPushHistory, type PushHistory } from '../../../../lib/push/push-history.js';
import type { NeedsYouNotification, PushProvider } from '../../../../lib/push/types.js';
import type { StoredEvent } from '../../event-store.js';

type Subscriber = (event: StoredEvent) => void;

function fakeStore() {
  const subscribers: Subscriber[] = [];
  const unsubscribe = vi.fn();
  return {
    subscribers,
    unsubscribe,
    store: {
      subscribe: (fn: Subscriber) => {
        subscribers.push(fn);
        return unsubscribe;
      },
    },
    emit(event: { type: string; timestamp?: string; payload: unknown; sequence?: number }) {
      for (const fn of subscribers) fn({ sequence: 1, timestamp: new Date().toISOString(), ...event } as unknown as StoredEvent);
    },
  };
}

function fakeProvider(hasTargets: boolean): PushProvider & { sent: NeedsYouNotification[] } {
  const sent: NeedsYouNotification[] = [];
  return {
    name: 'fake',
    sent,
    hasTargets: async () => hasTargets,
    send: async (n) => {
      sent.push(n);
      return [{ target: 'fake:1', ok: true }];
    },
  };
}

function feedWithQuestion() {
  return vi.fn(async () => ({
    body: [{
      name: 'my-conv',
      title: 'My conversation',
      pendingAskUserQuestion: { toolUseId: 'toolu_feed', askedAt: new Date().toISOString(), questions: [{ question: 'Q?' }] },
    }],
  }));
}

const sodium = createRequire(import.meta.url)('sodium-native') as {
  crypto_box_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
};

function seededKeyPair(fill: number): MachineKeyPair {
  const publicKey = Buffer.alloc(32);
  const secretKey = Buffer.alloc(32);
  sodium.crypto_box_seed_keypair(publicKey, secretKey, Buffer.alloc(32, fill));
  return { publicKey, secretKey };
}

// The service awaits the history load before its first scan; load the shared
// singleton (temp OVERDECK_HOME) up front so fake-timer scans never wait on file I/O.
beforeAll(async () => {
  await getPushHistory().ready();
});

describe('needs-you push service (PAN-2354)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(pollEnrichmentNow).mockClear();
  });

  afterEach(() => {
    stopNeedsYouPushService();
    vi.useRealTimers();
  });

  it('never reads the conversation feed without push targets', async () => {
    const feed = feedWithQuestion();
    startNeedsYouPushService({ readConversationFeed: feed, store: fakeStore().store, providers: [fakeProvider(false)] });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(feed).not.toHaveBeenCalled();
  });

  it('sends a fresh conversation question within one 5 s scan', async () => {
    const provider = fakeProvider(true);
    startNeedsYouPushService({ readConversationFeed: feedWithQuestion(), store: fakeStore().store, providers: [provider] });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toMatchObject({ kind: 'question', tag: 'auq:toolu_feed', url: '/m?subject=my-conv' });
  });

  it('sends after a 500 ms wake, well before the 5 s interval', async () => {
    const provider = fakeProvider(true);
    startNeedsYouPushService({ readConversationFeed: feedWithQuestion(), store: fakeStore().store, providers: [provider] });
    wakeNeedsYouPush('auq');
    await vi.advanceTimersByTimeAsync(499);
    expect(provider.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(provider.sent).toHaveLength(1);
    expect(pollEnrichmentNow).toHaveBeenCalledTimes(1);
  });

  it('wakes on a waiting conversation.permission_changed event', async () => {
    const provider = fakeProvider(true);
    const events = fakeStore();
    startNeedsYouPushService({ readConversationFeed: feedWithQuestion(), store: events.store, providers: [provider] });
    events.emit({ type: 'conversation.permission_changed', payload: { conversationName: 'my-conv', waiting: true } });
    await vi.advanceTimersByTimeAsync(500);
    expect(provider.sent).toHaveLength(1);
  });

  it('sends a failed notification for a pipeline.journal merge.failed event', async () => {
    const provider = fakeProvider(true);
    const events = fakeStore();
    startNeedsYouPushService({ readConversationFeed: vi.fn(async () => ({ body: [] })), store: events.store, providers: [provider] });
    events.emit({
      type: 'pipeline.journal',
      payload: { issueId: 'PAN-7', entry: { type: 'merge.failed', issueId: 'PAN-7', at: '2026-11-01T00:00:00.000Z' } },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.sent).toEqual([expect.objectContaining({
      kind: 'failed',
      body: 'Merge failed.',
      // PAN-5219: issue edges now open the phone issue sheet, not /m.
      url: phoneIssueSheetPath('PAN-7', { kind: 'merge.failed', at: '2026-11-01T00:00:00.000Z' }),
    })]);
  });

  // PAN-5074: a planning agent stopped by finalize must not push "stopped responding".
  it('sends no failed push for agent.heartbeat_dead when the stop was recorded before it', async () => {
    const provider = fakeProvider(true);
    const events = fakeStore();
    const stopRecordedBefore = vi.fn((agentId: string) => agentId === 'planning-pan-9');
    startNeedsYouPushService({ readConversationFeed: vi.fn(async () => ({ body: [] })), store: events.store, providers: [provider], stopRecordedBefore });
    events.emit({ type: 'agent.heartbeat_dead', sequence: 42, payload: { agentId: 'planning-pan-9', issueId: 'PAN-9' } });
    events.emit({ type: 'agent.heartbeat_dead', sequence: 43, payload: { agentId: 'agent-pan-9', issueId: 'PAN-9' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopRecordedBefore).toHaveBeenCalledWith('planning-pan-9', 42);
    expect(stopRecordedBefore).toHaveBeenCalledWith('agent-pan-9', 43);
    expect(provider.sent).toEqual([expect.objectContaining({ kind: 'failed', body: 'The agent stopped responding.', tag: expect.stringContaining('dead:agent-pan-9:') })]);
  });

  it('sends a question from an agent.enrichment_changed event', async () => {
    const provider = fakeProvider(true);
    const events = fakeStore();
    startNeedsYouPushService({ readConversationFeed: vi.fn(async () => ({ body: [] })), store: events.store, providers: [provider] });
    events.emit({
      type: 'agent.enrichment_changed',
      payload: { agentId: 'agent-pan-8', issueId: 'PAN-8', pendingAskUserQuestion: { toolUseId: 'toolu_a', askedAt: new Date().toISOString(), questions: [] } },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.sent).toEqual([expect.objectContaining({ kind: 'question', url: '/m?subject=agent-pan-8' })]);
  });

  it('stops: unsubscribes and reads the feed no more', async () => {
    const feed = feedWithQuestion();
    const events = fakeStore();
    startNeedsYouPushService({ readConversationFeed: feed, store: events.store, providers: [fakeProvider(true)] });
    await vi.advanceTimersByTimeAsync(5_000);
    const calls = feed.mock.calls.length;
    stopNeedsYouPushService();
    expect(events.unsubscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(feed.mock.calls.length).toBe(calls);
  });

  it('seals one push frame per phone for a needs-you event (PAN-4843 AC-9)', async () => {
    const phones = [
      { clientId: 'aaaaaaaa-0000-4000-8000-000000000001', keys: seededKeyPair(0x11) },
      { clientId: 'bbbbbbbb-0000-4000-8000-000000000002', keys: seededKeyPair(0x22) },
    ];
    const frames: Array<Extract<MachineToDirectoryFrame, { type: 'push' }>> = [];
    const handlers = new Set<Parameters<PushDirectoryPort['on']>[1]>();
    const port: PushDirectoryPort = {
      isOnline: () => true,
      on: (_type, handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      send: (frame) => {
        if (frame.type !== 'push') return true;
        frames.push(frame);
        for (const handler of [...handlers]) handler({ type: 'push-result', requestId: frame.requestId, ok: true });
        return true;
      },
    };
    const provider = createNativePushProvider({
      directory: () => port,
      listPhones: () => phones.map(({ clientId, keys }) => ({ clientId, pushKey: keys.publicKey.toString('hex') })),
      environmentId: async () => 'env-1',
      readPreferences: async () => new Map(),
    });
    const events = fakeStore();
    startNeedsYouPushService({ readConversationFeed: vi.fn(async () => ({ body: [] })), store: events.store, providers: [provider] });
    events.emit({
      type: 'agent.enrichment_changed',
      payload: { agentId: 'agent-pan-9', issueId: 'PAN-9', pendingAskUserQuestion: { toolUseId: 'toolu_n', askedAt: new Date().toISOString(), questions: [] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(frames.map((frame) => frame.to)).toEqual(phones.map((phone) => phone.clientId));
    frames.forEach((frame, index) => {
      const opened = openSealed(Buffer.from(frame.sealed, 'base64'), (phones[index] as (typeof phones)[number]).keys);
      expect(JSON.parse(opened?.toString('utf8') ?? 'null')).toMatchObject({ v: 1, machine: 'env-1', kind: 'question' });
    });
  });
});

describe('needs-you push service history (PAN-5111)', () => {
  const START = Date.parse('2026-11-10T12:00:00.000Z');
  let dir: string;
  let history: PushHistory;

  function question(askedAt: string) {
    return { name: 'my-conv', title: 'My conversation', pendingAskUserQuestion: { toolUseId: 'toolu_h', askedAt, questions: [{ question: 'Q?' }] } };
  }

  function mutableFeed(initial: unknown[]) {
    const feed = { rows: initial, read: vi.fn(async () => ({ body: feed.rows })) };
    return feed;
  }

  function switchableProvider(): PushProvider & { sent: NeedsYouNotification[]; targets: boolean } {
    const provider = {
      name: 'fake',
      sent: [] as NeedsYouNotification[],
      targets: true,
      hasTargets: async () => provider.targets,
      send: async (n: NeedsYouNotification) => {
        provider.sent.push(n);
        return [{ target: 'fake:1', ok: true as const }];
      },
    };
    return provider;
  }

  async function freshHistory(): Promise<PushHistory> {
    const h = createPushHistory({ dir });
    await h.ready();
    return h;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    resetOperatorAnswers();
    dir = await mkdtemp(join(tmpdir(), 'push-service-history-'));
    history = await freshHistory();
  });

  afterEach(async () => {
    stopNeedsYouPushService();
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it('shows a delivered question open, then answered-or-withdrawn once it leaves and the service is warm', async () => {
    const feed = mutableFeed([question(new Date(START).toISOString())]);
    startNeedsYouPushService({ readConversationFeed: feed.read, store: fakeStore().store, providers: [switchableProvider()], history });
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await getPushHistoryView()).map((e) => [e.key, e.subject, e.state])).toEqual([['auq:toolu_h', 'conv:my-conv', 'open']]);

    feed.rows = [];
    await vi.advanceTimersByTimeAsync(60_000);
    const [entry] = await getPushHistoryView();
    expect(entry!.resolution?.outcome).toBe('resolved-without-answer');
    expect(entry!.state).toBe('resolved-without-answer');
  });

  it('shows answered when the operator answered through Overdeck before the question left', async () => {
    const feed = mutableFeed([question(new Date(START).toISOString())]);
    startNeedsYouPushService({ readConversationFeed: feed.read, store: fakeStore().store, providers: [switchableProvider()], history });
    await vi.advanceTimersByTimeAsync(5_000);
    noteOperatorAnswer('auq:toolu_h');
    feed.rows = [];
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await getPushHistoryView()).map((e) => e.state)).toEqual(['answered']);
  });

  it('keeps recording departures without a push target, and pushes nothing new', async () => {
    const provider = switchableProvider();
    const feed = mutableFeed([question(new Date(START).toISOString())]);
    startNeedsYouPushService({ readConversationFeed: feed.read, store: fakeStore().store, providers: [provider], history });
    await vi.advanceTimersByTimeAsync(5_000);

    provider.targets = false;
    feed.rows = [{ name: 'my-conv', title: 'My conversation', pendingAskUserQuestion: { toolUseId: 'toolu_new', askedAt: new Date().toISOString(), questions: [] } }];
    await vi.advanceTimersByTimeAsync(20_000);

    expect(provider.sent.map((n) => n.tag)).toEqual(['auq:toolu_h']);
    const entries = await history.recent();
    expect(entries.map((e) => [e.key, e.resolution?.outcome ?? null])).toEqual([['auq:toolu_h', 'resolved-without-answer']]);
  });

  it('re-adopts an open entry after a restart instead of calling it withdrawn', async () => {
    const askedAt = new Date(START).toISOString();
    const feed = mutableFeed([question(askedAt)]);
    startNeedsYouPushService({ readConversationFeed: feed.read, store: fakeStore().store, providers: [switchableProvider()], history });
    await vi.advanceTimersByTimeAsync(5_000);
    await history.flush();
    const [pushed] = await history.recent();
    stopNeedsYouPushService();

    // Restart well after the question was asked, so the still-pending item is primed.
    await vi.advanceTimersByTimeAsync(120_000);
    const restarted = await freshHistory();
    const provider = switchableProvider();
    startNeedsYouPushService({ readConversationFeed: feed.read, store: fakeStore().store, providers: [provider], history: restarted });
    expect((await getPushHistoryView()).map((e) => e.state)).toEqual([null]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect((await getPushHistoryView()).map((e) => e.state)).toEqual(['open']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await getPushHistoryView()).map((e) => e.state)).toEqual(['open']);
    expect(provider.sent).toHaveLength(0);

    feed.rows = [];
    await vi.advanceTimersByTimeAsync(20_000);
    const [entry] = await restarted.recent();
    expect(entry!.id).toBe(pushed!.id);
    expect(entry!.resolution?.outcome).toBe('resolved-without-answer');
  });
});
