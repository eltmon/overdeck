/**
 * Tests for smee.ts (PAN-905)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startSmeeClient,
  stopSmeeClient,
  isSmeeRunning,
} from '../../../src/lib/smee.js';

// ─── Mock state ──────────────────────────────────────────────────────────────

const mockStart = vi.fn();
const mockStop = vi.fn();
let capturedOnError: ((ev: unknown) => void) | null = null;

vi.mock('smee-client', () => ({
  default: class {
    _onerror: ((ev: unknown) => void) | null = null;
    get onerror() {
      return this._onerror;
    }
    set onerror(fn: ((ev: unknown) => void) | null) {
      this._onerror = fn;
      capturedOnError = fn;
    }
    async start() {
      return mockStart();
    }
    async stop() {
      return mockStop();
    }
  },
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: Parameters<typeof mockExistsSync>) => mockExistsSync(...args),
  readFileSync: (...args: Parameters<typeof mockReadFileSync>) => mockReadFileSync(...args),
}));

const mockLoadConfig = vi.fn(() => ({
  dashboard: { api_port: 3011 },
}));

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: (...args: Parameters<typeof mockLoadConfig>) => mockLoadConfig(...args),
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue('https://smee.io/abc123');
  mockStart.mockResolvedValue(undefined);
  mockStop.mockResolvedValue(undefined);
  capturedOnError = null;
});

afterEach(async () => {
  // Ensure any pending timers are cleared and client is stopped
  await stopSmeeClient();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('startSmeeClient', () => {
  it('logs warning and skips when smee-url file is missing', async () => {
    mockExistsSync.mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await startSmeeClient();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No smee-url configured'),
    );
    expect(mockStart).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('starts client and sets active state when smee-url exists', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await startSmeeClient();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(isSmeeRunning()).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Relaying'),
    );
    logSpy.mockRestore();
  });

  it('logs and returns early if already running', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await startSmeeClient();
    await startSmeeClient();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[smee] Already running');
    logSpy.mockRestore();
  });

  it('schedules restart on start failure', async () => {
    mockStart.mockRejectedValue(new Error('connection refused'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const promise = startSmeeClient();
    await promise;

    expect(errorSpy).toHaveBeenCalledWith(
      '[smee] Failed to start:',
      'connection refused',
    );
    expect(isSmeeRunning()).toBe(false);

    // Advance past first retry delay (1s)
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(mockStart).toHaveBeenCalledTimes(2);

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('schedules restart on client error event', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await startSmeeClient();
    expect(isSmeeRunning()).toBe(true);

    // Simulate an error from the EventSource
    mockStart.mockRejectedValue(new Error('reconnect failed'));
    capturedOnError?.({});

    expect(isSmeeRunning()).toBe(false);

    // Advance past first retry delay
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(mockStart).toHaveBeenCalledTimes(2);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('gives up after max restart attempts', async () => {
    mockStart.mockRejectedValue(new Error('permanent failure'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await startSmeeClient();

    // Trigger 5 retries and fully drain the async restart chain after each step.
    for (let i = 0; i < 5; i++) {
      const delay = Math.min(1_000 * 2 ** i, 30_000);
      vi.advanceTimersByTime(delay);
      for (let flush = 0; flush < 5; flush++) {
        await Promise.resolve();
      }
    }

    // 1 initial + 5 retries = 6 starts total
    expect(mockStart).toHaveBeenCalledTimes(6);
    expect(errorSpy).toHaveBeenCalledWith(
      '[smee] Max restart attempts reached — giving up',
    );

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('stopSmeeClient', () => {
  it('stops running client', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await startSmeeClient();
    expect(isSmeeRunning()).toBe(true);

    await stopSmeeClient();

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(isSmeeRunning()).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('[smee] Stopped');
    logSpy.mockRestore();
  });

  it('is safe to call when not running', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await stopSmeeClient();

    expect(mockStop).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[smee] Stopped');
    logSpy.mockRestore();
  });

  it('cancels pending restart on stop', async () => {
    mockStart.mockRejectedValue(new Error('fail'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await startSmeeClient();
    await stopSmeeClient();

    // Advance time — no restart should fire
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(mockStart).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe('webhook target', () => {
  it('uses configured api_port from config', async () => {
    mockLoadConfig.mockReturnValue({ dashboard: { api_port: 9999 } });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await startSmeeClient();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:9999/api/webhooks/github'),
    );
    logSpy.mockRestore();
  });
});
