import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsWatchdog } from '../tts-watchdog.js';
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

vi.mock('../../lib/config-yaml.js', () => ({
  loadConfig: () => ({ config: { tts: mocks.ttsConfig } }),
}));

vi.mock('../../lib/tts-daemon.js', () => ({
  getTtsDaemonStatus: mocks.getStatus,
  hasTtsDaemonState: mocks.hasState,
  isTtsDaemonManuallyStopped: mocks.isManuallyStopped,
  startTtsDaemon: mocks.startDaemon,
}));

async function tick(watchdog: TtsWatchdog): Promise<void> {
  await (watchdog as unknown as { tick: () => Promise<void> }).tick();
}

describe('TtsWatchdog', () => {
  beforeEach(() => {
    mocks.ttsConfig.enabled = true;
    mocks.ttsConfig.daemonAutoStart = false;
    mocks.getStatus.mockReset();
    mocks.hasState.mockReset().mockResolvedValue(false);
    mocks.isManuallyStopped.mockReset().mockResolvedValue(false);
    mocks.startDaemon.mockReset().mockResolvedValue({ ok: true, pid: 1234, alreadyRunning: false });
  });

  it('does not restart after an intentional stop while activity TTS remains enabled', async () => {
    mocks.isManuallyStopped.mockResolvedValue(true);
    const watchdog = new TtsWatchdog({
      config: { enabled: true, pollMs: 5_000, failThreshold: 1, maxRestarts: 3, windowMs: 60_000, startTimeoutMs: 25_000 },
      log: vi.fn(),
    });

    await tick(watchdog);

    expect(watchdog.status()).toMatchObject({ active: false, consecutiveFailures: 0, lastError: null });
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.startDaemon).not.toHaveBeenCalled();
  });

  it('restarts an unexpectedly stopped daemon when state still exists', async () => {
    mocks.ttsConfig.enabled = false;
    mocks.hasState.mockResolvedValue(true);
    mocks.getStatus.mockResolvedValue({ ok: false, running: false, pid: null, daemonHost: '127.0.0.1', daemonPort: 8787, error: 'daemon unreachable' });
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
    mocks.isManuallyStopped.mockResolvedValue(true);
    const watchdog = new TtsWatchdog({
      config: { enabled: true, pollMs: 5_000, failThreshold: 1, maxRestarts: 3, windowMs: 60_000, startTimeoutMs: 25_000 },
      log: vi.fn(),
    });

    await tick(watchdog);

    expect(watchdog.status().active).toBe(false);
    expect(mocks.startDaemon).not.toHaveBeenCalled();
  });
});
