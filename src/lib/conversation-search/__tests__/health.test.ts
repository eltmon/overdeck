import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getConversationSearchHealth,
  recordConversationSearchFailure,
  recordConversationSearchSuccess,
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
});
