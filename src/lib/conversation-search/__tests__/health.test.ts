import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getConversationSearchHealth,
  recordConversationSearchFailure,
  recordConversationSearchSuccess,
  recordConversationSearchWatcherError,
  recordConversationSearchWatcherFailed,
  recordConversationSearchWatcherRestarted,
  recordConversationSearchWatcherStarted,
  recordConversationSearchWatcherStopped,
  resetConversationSearchHealthForTests,
} from '../health.js';

describe('conversation-search health tracking', () => {
  beforeEach(() => {
    resetConversationSearchHealthForTests();
  });

  afterEach(() => {
    resetConversationSearchHealthForTests();
  });

  it('starts empty', () => {
    expect(getConversationSearchHealth()).toEqual({
      lastErrorAt: null,
      lastErrorReason: null,
      lastSuccessAt: null,
      watcher: null,
    });
  });

  it('records a failure with a readable reason', () => {
    recordConversationSearchFailure(new Error('You have no credits remaining.'));
    const health = getConversationSearchHealth();
    expect(health.lastErrorAt).not.toBeNull();
    expect(health.lastErrorReason).toBe('You have no credits remaining.');
    expect(health.lastSuccessAt).toBeNull();
  });

  it('stringifies non-Error failures', () => {
    recordConversationSearchFailure('quota exceeded');
    expect(getConversationSearchHealth().lastErrorReason).toBe('quota exceeded');
  });

  it('keeps the last error when success follows, so staleness is detectable by timestamp', () => {
    recordConversationSearchFailure(new Error('boom'));
    recordConversationSearchSuccess();
    const health = getConversationSearchHealth();
    expect(health.lastSuccessAt).not.toBeNull();
    expect(new Date(health.lastSuccessAt as string).getTime())
      .toBeGreaterThanOrEqual(new Date(health.lastErrorAt as string).getTime());
    expect(health.lastErrorReason).toBe('boom');
  });

  it('returns snapshot copies, not live state', () => {
    recordConversationSearchFailure(new Error('first'));
    const snapshot = getConversationSearchHealth();
    recordConversationSearchFailure(new Error('second'));
    expect(snapshot.lastErrorReason).toBe('first');
  });

  it('tracks the transcript watcher through error, restart, and stop (PAN-3915)', () => {
    recordConversationSearchWatcherStarted();
    expect(getConversationSearchHealth().watcher).toEqual({ state: 'running', restarts: 0, lastErrorAt: null, lastErrorReason: null, nextRestartAt: null });

    recordConversationSearchWatcherError(new Error('Unable to poll: Interrupted system call'), 1_000);
    const failed = getConversationSearchHealth().watcher;
    expect(failed?.state).toBe('restarting');
    expect(failed?.lastErrorReason).toBe('Unable to poll: Interrupted system call');
    expect(new Date(failed!.nextRestartAt!).getTime() - new Date(failed!.lastErrorAt!).getTime()).toBe(1_000);
    // A watcher error is not an embed failure.
    expect(getConversationSearchHealth().lastErrorAt).toBeNull();

    recordConversationSearchWatcherRestarted();
    expect(getConversationSearchHealth().watcher).toMatchObject({ state: 'running', restarts: 1, nextRestartAt: null, lastErrorReason: 'Unable to poll: Interrupted system call' });

    recordConversationSearchWatcherStopped();
    expect(getConversationSearchHealth().watcher).toBeNull();
  });

  it('marks a watcher whose restarts stopped as failed and points ENOSPC/EMFILE at the inotify limit (PAN-3915)', () => {
    recordConversationSearchWatcherStarted();
    recordConversationSearchWatcherRestarted();
    recordConversationSearchWatcherFailed(Object.assign(new Error('watch failed'), { code: 'EMFILE' }));
    const failed = getConversationSearchHealth().watcher;
    expect(failed).toMatchObject({ state: 'failed', restarts: 1, nextRestartAt: null });
    expect(failed?.lastErrorReason).toBe('watch failed (inotify watch limit reached; raise fs.inotify.max_user_watches)');

    recordConversationSearchWatcherFailed(new Error('Unable to poll: Interrupted system call'));
    expect(getConversationSearchHealth().watcher?.lastErrorReason).toBe('Unable to poll: Interrupted system call');
    expect(getConversationSearchHealth().lastErrorAt).toBeNull();
  });
});
