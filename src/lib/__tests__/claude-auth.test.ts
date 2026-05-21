/**
 * Tests for parseOAuthPayload (PAN-593)
 * Migrated to Effect in PAN-1249 wave-0.
 */

import { describe, it, expect } from 'vitest';
import { Cause, Effect, Exit } from 'effect';
import { parseOAuthPayload } from '../claude-auth.js';
import { ClaudeCredentialParseError } from '../errors.js';

async function runEffect<A>(effect: Effect.Effect<A, never, never>): Promise<A> {
  const exit = await Effect.runPromise(Effect.exit(effect));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

async function runEffectFail<A, E>(effect: Effect.Effect<A, E, never>): Promise<E> {
  const exit = await Effect.runPromise(Effect.exit(effect));
  if (Exit.isSuccess(exit))
    throw new Error('Expected effect to fail, got: ' + JSON.stringify(exit.value));
  return Cause.squash(exit.cause) as E;
}

describe('parseOAuthPayload', () => {
  it('returns loggedIn: true with valid credentials', async () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-xxx',
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_20x',
        expiresAt: Date.now() + 3600_000,
      },
    });
    const result = await runEffect(parseOAuthPayload(raw));
    expect(result.loggedIn).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.subscriptionType).toBe('max');
    expect(result.rateLimitTier).toBe('default_claude_max_20x');
  });

  it('returns loggedIn: false when accessToken is missing', async () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        subscriptionType: 'pro',
      },
    });
    const result = await runEffect(parseOAuthPayload(raw));
    expect(result.loggedIn).toBe(false);
    expect(result.subscriptionType).toBeNull();
  });

  it('detects expired tokens', async () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-xxx',
        subscriptionType: 'team',
        expiresAt: Date.now() - 60_000, // expired 1 minute ago
      },
    });
    const result = await runEffect(parseOAuthPayload(raw));
    expect(result.loggedIn).toBe(true); // still logged in — auto-refresh
    expect(result.expired).toBe(true);
    expect(result.subscriptionType).toBe('team');
  });

  it('handles missing claudeAiOauth gracefully', async () => {
    const raw = JSON.stringify({ someOtherKey: 'value' });
    const result = await runEffect(parseOAuthPayload(raw));
    expect(result.loggedIn).toBe(false);
    expect(result.expired).toBe(false);
    expect(result.subscriptionType).toBeNull();
    expect(result.expiresAt).toBeNull();
  });

  it('handles non-string subscriptionType', async () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-xxx',
        subscriptionType: 42,
        expiresAt: 'not-a-number',
      },
    });
    const result = await runEffect(parseOAuthPayload(raw));
    expect(result.loggedIn).toBe(true);
    expect(result.subscriptionType).toBeNull();
    expect(result.expiresAt).toBeNull();
  });

  it('fails with ClaudeCredentialParseError on malformed JSON', async () => {
    const err = await runEffectFail(parseOAuthPayload('not json'));
    expect(err).toBeInstanceOf(ClaudeCredentialParseError);
    expect((err as ClaudeCredentialParseError)._tag).toBe('ClaudeCredentialParseError');
  });

  it('handles empty object', async () => {
    const result = await runEffect(parseOAuthPayload('{}'));
    expect(result.loggedIn).toBe(false);
  });
});
