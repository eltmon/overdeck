/**
 * Tests for parseOAuthPayload (PAN-593)
 */

import { describe, it, expect } from 'vitest';
import { parseOAuthPayload } from '../claude-auth.js';

describe('parseOAuthPayload', () => {
  it('returns loggedIn: true with valid credentials', () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-xxx',
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_20x',
        expiresAt: Date.now() + 3600_000,
      },
    });
    const result = parseOAuthPayload(raw);
    expect(result.loggedIn).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.subscriptionType).toBe('max');
    expect(result.rateLimitTier).toBe('default_claude_max_20x');
  });

  it('returns loggedIn: false when accessToken is missing', () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        subscriptionType: 'pro',
      },
    });
    const result = parseOAuthPayload(raw);
    expect(result.loggedIn).toBe(false);
    expect(result.subscriptionType).toBeNull();
  });

  it('detects expired tokens', () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-xxx',
        subscriptionType: 'team',
        expiresAt: Date.now() - 60_000, // expired 1 minute ago
      },
    });
    const result = parseOAuthPayload(raw);
    expect(result.loggedIn).toBe(true); // still logged in — auto-refresh
    expect(result.expired).toBe(true);
    expect(result.subscriptionType).toBe('team');
  });

  it('handles missing claudeAiOauth gracefully', () => {
    const raw = JSON.stringify({ someOtherKey: 'value' });
    const result = parseOAuthPayload(raw);
    expect(result.loggedIn).toBe(false);
    expect(result.expired).toBe(false);
    expect(result.subscriptionType).toBeNull();
    expect(result.expiresAt).toBeNull();
  });

  it('handles non-string subscriptionType', () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-xxx',
        subscriptionType: 42,
        expiresAt: 'not-a-number',
      },
    });
    const result = parseOAuthPayload(raw);
    expect(result.loggedIn).toBe(true);
    expect(result.subscriptionType).toBeNull();
    expect(result.expiresAt).toBeNull();
  });

  it('throws on malformed JSON', () => {
    expect(() => parseOAuthPayload('not json')).toThrow();
  });

  it('handles empty object', () => {
    const result = parseOAuthPayload('{}');
    expect(result.loggedIn).toBe(false);
  });
});
