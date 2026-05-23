import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTtsWatchdogConfig, TtsWatchdog } from '../tts-watchdog.js';
import type { NormalizedTtsDaemonConfig } from '../../lib/config-yaml.js';

const mocks = vi.hoisted(() => ({
  ttsConfig: {
    enabled: true,
    voice: '',
    volume: 1,
    rate: 1,
    maxChars: 140,
    dropInfoWhenFull: true,
    daemonHost: '127.0.0.1',
    daemonPort: 8787,
    daemonAutoStart: false,
    voiceMap: {},
    mutedSources: [],
    utteranceTemplates: {},
    mutedIssues: [],
  } as NormalizedTtsDaemonConfig,
  getStatus: vi.fn(),
  hasState: vi.fn(),
  isManuallyStopped: vi.fn(),
  startDaemon: vi.fn(),
}));

vi.mock('../../lib/config-yaml.js', async () => {
  const { Effect: EffectHoisted } = await import('effect');
  return {
    loadConfigNoMigration: () => EffectHoisted.succeed({ config: { tts: mocks.ttsConfig } }),
  };
});

vi.mock('../../lib/tts-daemon.js', () => ({
  getTtsDaemonStatus: mocks.getStatus,
  hasTtsDaemonState: mocks.hasState,
  isTtsDaemonManuallyStopped: mocks.isManuallyStopped,
  startTtsDaemon: mocks.startDaemon,
}));

async function tick(watchdog: TtsWatchdog): Promise<void> {
  await (watchdog as unknown as { tick: () => Promise<void> }).tick();
}

describe('readTtsWatchdogConfig', () => {
  it('falls back from invalid timing env vars and clamps unsafe minimums', () => {
    expect(readTtsWatchdogConfig({
      PANOPTICON_TTS_WATCHDOG_POLL_MS: '0',
      PANOPTICON_TTS_WATCHDOG_FAIL_THRESHOLD: 'abc',
      PANOPTICON_TTS_WATCHDOG_MAX_RESTARTS: 'NaN',
      PANOPTICON_TTS_WATCHDOG_WINDOW_MS: '-1',
      PANOPTICON_TTS_WATCHDOG_START_TIMEOUT_MS: '1',
    })).toEqual({
      enabled: true,
      pollMs: 5_000,
      failThreshold: 1,
      maxRestarts: 3,
      windowMs: 10 * 60_000,
      startTimeoutMs: 1_000,
    });
  });
});

describe('TtsWatchdog', () => {
  beforeEach(() => {
    mocks.ttsConfig.enabled = true;
    mocks.ttsConfig.daemonAutoStart = false;
    mocks.getStatus.mockReset();
    mocks.hasState.mockReset().mockReturnValue(Effect.succeed(false));
    mocks.isManuallyStopped.mockReset().mockReturnValue(Effect.succeed(false));
    mocks.startDaemon.mockReset().mockReturnValue(Effect.succeed({ ok: true, pid: 1234, alreadyRunning: false }));
  });

  it('does not restart after an intentional stop while activity TTS remains enabled', async () => {
    mocks.isManuallyStopped.mockReturnValue(Effect.succeed(true));
    const watchdog = new TtsWatchdog({
      config: { enabled: true, pollMs: 5_000, failThreshold: 1, maxRestarts: 3, windowMs: 60_000, startTimeoutMs: 25_000 },
      log: vi.fn(),
    });

    await tick(watchdog);

    expect(watchdog.status()).toMatchObject({ active: false, consecutiveFailures: 0, lastError: null });
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.startDaemon).not.toHaveBeenCalled();
  });

  it('does not restart a live daemon that is still initializing', async () => {
    mocks.hasState.mockReturnValue(Effect.succeed(true));
    mocks.getStatus.mockReturnValue(Effect.succeed({
      ok: false,
      running: true,
      managed: true,
      phase: 'starting',
      initializing: true,
      pid: 4242,
      daemonHost: '127.0.0.1',
      daemonPort: 8787,
      error: 'daemon starting',
    }));
    const watchdog = new TtsWatchdog({
      config: { enabled: true, pollMs: 5_000, failThreshold: 1, maxRestarts: 3, windowMs: 60_000, startTimeoutMs: 25_000 },
      log: vi.fn(),
    });

    await tick(watchdog);

    expect(watchdog.status()).toMatchObject({ active: true, consecutiveFailures: 0, lastError: 'daemon starting' });
    expect(mocks.startDaemon).not.toHaveBeenCalled();
  });

  it('restarts an unexpectedly stopped daemon when state still exists', async () => {
    mocks.ttsConfig.enabled = false;
    mocks.hasState.mockReturnValue(Effect.succeed(true));
    mocks.getStatus.mockReturnValue(Effect.succeed({ ok: false, running: false, pid: null, phase: 'stopped', daemonHost: '127.0.0.1', daemonPort: 8787, error: 'daemon unreachable' }));
    const log = vi.fn();
    const watchdog = new TtsWatchdog({
      config: { enabled: true, pollMs: 5_000, failThreshold: 1, maxRestarts: 3, windowMs: 60_000, startTimeoutMs: 25_000 },
      log,
    });

    await tick(watchdog);

    expect(watchdog.status()).toMatchObject({ active: true, consecutiveFailures: 0, lastError: null });
    expect(mocks.startDaemon).toHaveBeenCalledWith({ config: mocks.ttsConfig, detach: true, timeoutMs: 25_000 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('tts watchdog restarted daemon'));
  });

  it('respects a manual stop even when daemon auto-start is enabled', async () => {
    mocks.ttsConfig.daemonAutoStart = true;
    mocks.isManuallyStopped.mockReturnValue(Effect.succeed(true));
    const watchdog = new TtsWatchdog({
      config: { enabled: true, pollMs: 5_000, failThreshold: 1, maxRestarts: 3, windowMs: 60_000, startTimeoutMs: 25_000 },
      log: vi.fn(),
    });

    await tick(watchdog);

    expect(watchdog.status().active).toBe(false);
    expect(mocks.startDaemon).not.toHaveBeenCalled();
  });

  it('does not schedule another poll when stopped during an in-flight tick', async () => {
    vi.useFakeTimers();
    let resolveManualStop!: (value: boolean) => void;
    mocks.isManuallyStopped.mockReturnValue(Effect.promise(() => new Promise<boolean>((resolve) => {
      resolveManualStop = resolve;
    })));
    const watchdog = new TtsWatchdog({
      config: { enabled: true, pollMs: 100, failThreshold: 1, maxRestarts: 3, windowMs: 60_000, startTimeoutMs: 25_000 },
      log: vi.fn(),
    });

    try {
      watchdog.start();
      await vi.advanceTimersByTimeAsync(100);
      watchdog.stop();
      resolveManualStop(false);
      await vi.advanceTimersByTimeAsync(0);

      expect(watchdog.status().nextPollAt).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
