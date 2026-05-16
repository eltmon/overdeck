import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  initEventStore: vi.fn(),
  resolveAndSpeak: vi.fn(),
}));

vi.mock('../../../../lib/config-yaml.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../../event-store.js', () => ({
  initEventStore: mocks.initEventStore,
}));

vi.mock('../../../../lib/tts-speak.js', () => ({
  resolveAndSpeak: mocks.resolveAndSpeak,
}));

import { startTtsPlayback, stopTtsPlayback } from '../tts-playback.js';
import type { StoredEvent } from '../../event-store.js';

describe('TtsPlaybackService', () => {
  let subscribers: Array<(event: StoredEvent) => void>;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let subscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    subscribers = [];
    unsubscribe = vi.fn();
    subscribe = vi.fn((fn: (event: StoredEvent) => void) => {
      subscribers.push(fn);
      return unsubscribe;
    });

    mocks.loadConfig.mockReturnValue({ config: { tts: { enabled: true } } });
    mocks.initEventStore.mockResolvedValue({ subscribe });
    mocks.resolveAndSpeak.mockResolvedValue('spoken');
  });

  afterEach(() => {
    stopTtsPlayback();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('does not start when tts is disabled', async () => {
    mocks.loadConfig.mockReturnValue({ config: { tts: { enabled: false } } });

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
    }));
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
