import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedTtsDaemonConfig } from '../../../../lib/config-yaml.js';

const baseTtsConfig = (): NormalizedTtsDaemonConfig => ({
  enabled: true,
  voice: 'voice-main',
  volume: 1,
  rate: 1,
  maxChars: 140,
  dropInfoWhenFull: true,
  daemonHost: '127.0.0.1',
  daemonPort: 8787,
  voiceMap: {},
  mutedSources: [],
  utteranceTemplates: {},
  mutedIssues: [],
});

const mocks = vi.hoisted(() => ({
  initEventStore: vi.fn(),
  resolveAndSpeak: vi.fn(),
  getTtsRuntimeConfig: vi.fn(),
}));

vi.mock('../../event-store.js', () => ({
  initEventStore: mocks.initEventStore,
}));

vi.mock('../../../../lib/tts-speak.js', () => ({
  resolveAndSpeak: mocks.resolveAndSpeak,
}));

vi.mock('../tts-runtime-config.js', () => ({
  getTtsRuntimeConfig: mocks.getTtsRuntimeConfig,
}));

import { startTtsPlayback, stopTtsPlayback } from '../tts-playback.js';
import type { StoredEvent } from '../../event-store.js';

describe('TtsPlaybackService', () => {
  let subscribers: Array<(event: StoredEvent) => void>;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let subscribe: ReturnType<typeof vi.fn>;
  let config: NormalizedTtsDaemonConfig;

  beforeEach(() => {
    subscribers = [];
    unsubscribe = vi.fn();
    subscribe = vi.fn((fn: (event: StoredEvent) => void) => {
      subscribers.push(fn);
      return unsubscribe;
    });
    config = baseTtsConfig();

    mocks.getTtsRuntimeConfig.mockImplementation(() => config);
    mocks.initEventStore.mockResolvedValue({ subscribe });
    mocks.resolveAndSpeak.mockResolvedValue('spoken');
  });

  afterEach(() => {
    stopTtsPlayback();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('does not start when tts is disabled', async () => {
    config = { ...config, enabled: false };

    await startTtsPlayback();

    expect(mocks.initEventStore).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('calls resolveAndSpeak for each activity.tts event when enabled', async () => {
    await startTtsPlayback();

    subscribers[0]({
      sequence: 1,
      type: 'activity.tts',
      timestamp: '2026-05-16T00:00:00.000Z',
      payload: {
        utterance: 'PAN-829 passed review',
        source: 'review-specialist',
        eventType: 'reviewStatus.passed',
        issueId: 'PAN-829',
        priority: 1,
      },
    });

    await vi.waitFor(() => expect(mocks.resolveAndSpeak).toHaveBeenCalledWith({
      text: 'PAN-829 passed review',
      source: 'review-specialist',
      eventType: 'reviewStatus.passed',
      issueId: 'PAN-829',
      priority: 1,
    }, { config }));
  });

  it('ignores non-tts events', async () => {
    await startTtsPlayback();

    subscribers[0]({
      sequence: 1,
      type: 'activity.entry',
      timestamp: '2026-05-16T00:00:00.000Z',
      payload: { message: 'ignored' },
    });

    expect(mocks.resolveAndSpeak).not.toHaveBeenCalled();
  });

  it('serializes activity.tts playback instead of firing concurrent daemon calls', async () => {
    let resolveFirst: (value: 'spoken') => void = () => undefined;
    mocks.resolveAndSpeak.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    mocks.resolveAndSpeak.mockResolvedValue('spoken');
    await startTtsPlayback();

    subscribers[0]({ sequence: 1, type: 'activity.tts', timestamp: '2026-05-16T00:00:00.000Z', payload: { utterance: 'first' } });
    subscribers[0]({ sequence: 2, type: 'activity.tts', timestamp: '2026-05-16T00:00:01.000Z', payload: { utterance: 'second' } });

    await vi.waitFor(() => expect(mocks.resolveAndSpeak).toHaveBeenCalledTimes(1));
    resolveFirst('spoken');
    await vi.waitFor(() => expect(mocks.resolveAndSpeak).toHaveBeenCalledTimes(2));
  });

  it('drops routine info events when the queue is full', async () => {
    let resolveFirst: (value: 'spoken') => void = () => undefined;
    mocks.resolveAndSpeak.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    mocks.resolveAndSpeak.mockResolvedValue('spoken');
    await startTtsPlayback();

    subscribers[0]({ sequence: 1, type: 'activity.tts', timestamp: '2026-05-16T00:00:00.000Z', payload: { utterance: 'first' } });
    for (let i = 0; i < 20; i++) {
      subscribers[0]({ sequence: i + 2, type: 'activity.tts', timestamp: '2026-05-16T00:00:01.000Z', payload: { utterance: `queued ${i}`, priority: 1 } });
    }
    subscribers[0]({ sequence: 30, type: 'activity.tts', timestamp: '2026-05-16T00:00:02.000Z', payload: { utterance: 'routine info', priority: 2 } });

    resolveFirst('spoken');

    await vi.waitFor(() => expect(mocks.resolveAndSpeak).toHaveBeenCalledTimes(21));
    expect(mocks.resolveAndSpeak.mock.calls.map(([input]) => input.text)).not.toContain('routine info');
  });

  it('clears queued playback on stop', async () => {
    let resolveFirst: (value: 'spoken') => void = () => undefined;
    mocks.resolveAndSpeak.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    mocks.resolveAndSpeak.mockResolvedValue('spoken');
    await startTtsPlayback();

    subscribers[0]({ sequence: 1, type: 'activity.tts', timestamp: '2026-05-16T00:00:00.000Z', payload: { utterance: 'first' } });
    subscribers[0]({ sequence: 2, type: 'activity.tts', timestamp: '2026-05-16T00:00:01.000Z', payload: { utterance: 'second' } });

    await vi.waitFor(() => expect(mocks.resolveAndSpeak).toHaveBeenCalledTimes(1));
    stopTtsPlayback();
    resolveFirst('spoken');

    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    expect(mocks.resolveAndSpeak).toHaveBeenCalledTimes(1);
  });

  it('is idempotent and does not double-subscribe', async () => {
    await startTtsPlayback();
    await startTtsPlayback();

    expect(mocks.initEventStore).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on stop', async () => {
    await startTtsPlayback();

    stopTtsPlayback();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('logs and continues when the daemon is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.resolveAndSpeak.mockResolvedValue('daemon-unavailable');
    await startTtsPlayback();

    subscribers[0]({
      sequence: 1,
      type: 'activity.tts',
      timestamp: '2026-05-16T00:00:00.000Z',
      payload: { utterance: 'daemon down' },
    });

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[tts-playback] TTS daemon unavailable'));
  });
});
