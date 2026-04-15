/**
 * Unit tests for flywheel-daemon scaffold (PAN-709)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startFlywheelDaemon,
  stopFlywheelDaemon,
  isFlywheelDaemonRunning,
  getFlywheelDaemonStatus,
  setFlywheelMergeCompleteHandler,
  notifyFlywheelMergeComplete,
} from '../flywheel-daemon.js';

// Stub loadCloisterConfig to avoid needing a real config file
vi.mock('../../lib/cloister/config.js', () => ({
  loadCloisterConfig: () => ({}),
}));

// Stub existsSync/writeFileSync to avoid touching real filesystem
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    readFileSync: actual.readFileSync,
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ mtimeMs: 0, isDirectory: () => false, isSymbolicLink: () => false }),
  };
});

describe('flywheelDaemon', () => {
  beforeEach(() => {
    // Ensure daemon is stopped before each test
    stopFlywheelDaemon();
  });

  afterEach(() => {
    // Always stop after each test to prevent interval leaks
    stopFlywheelDaemon();
  });

  it('starts without errors', () => {
    expect(() => startFlywheelDaemon()).not.toThrow();
    expect(isFlywheelDaemonRunning()).toBe(true);
  });

  it('stops without errors', () => {
    startFlywheelDaemon();
    expect(isFlywheelDaemonRunning()).toBe(true);
    expect(() => stopFlywheelDaemon()).not.toThrow();
    expect(isFlywheelDaemonRunning()).toBe(false);
  });

  it('is idempotent: double start does not create two intervals', () => {
    startFlywheelDaemon();
    startFlywheelDaemon(); // second call should be a no-op
    expect(isFlywheelDaemonRunning()).toBe(true);
    stopFlywheelDaemon();
    expect(isFlywheelDaemonRunning()).toBe(false);
  });

  it('is idempotent: stop when not running is a no-op', () => {
    expect(() => stopFlywheelDaemon()).not.toThrow();
    expect(isFlywheelDaemonRunning()).toBe(false);
  });

  it('getFlywheelDaemonStatus returns correct isRunning state', () => {
    expect(getFlywheelDaemonStatus().isRunning).toBe(false);
    startFlywheelDaemon();
    expect(getFlywheelDaemonStatus().isRunning).toBe(true);
    stopFlywheelDaemon();
    expect(getFlywheelDaemonStatus().isRunning).toBe(false);
  });

  it('setFlywheelMergeCompleteHandler registers a handler without error', () => {
    const handler = vi.fn();
    // Just verify registration doesn't throw; the handler is called when merge completes
    // and the daemon is not in quiet hours (tested at integration level)
    expect(() => setFlywheelMergeCompleteHandler(handler)).not.toThrow();
    // Clean up
    setFlywheelMergeCompleteHandler(() => {});
  });
});
