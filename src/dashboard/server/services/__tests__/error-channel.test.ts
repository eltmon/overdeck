/**
 * Error channel tests for typed errors in Effect services (PAN-449)
 *
 * Verifies that each typed error has the correct `_tag`, fields, and
 * that Effect services properly propagate errors through typed channels.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';
import {
  TrackerNotConfigured,
  IssueNotFound,
  RateLimited,
  TrackerApiError,
  WorkspaceNotFound,
  WorkspaceCreateError,
  AgentAlreadyRunning,
  BeadsNotInitialized,
  AgentStartError,
} from '../typed-errors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runEffectFail<A, E>(effect: Effect.Effect<A, E, never>): Promise<E> {
  const exit = await Effect.runPromise(Effect.exit(effect));
  if (Exit.isSuccess(exit))
    throw new Error('Expected effect to fail, got: ' + JSON.stringify(exit.value));
  return Cause.squash(exit.cause) as E;
}

async function runEffect<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  const exit = await Effect.runPromise(Effect.exit(effect));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Typed errors — structure', () => {
  it('TrackerNotConfigured has _tag and tracker field', () => {
    const err = new TrackerNotConfigured({ tracker: 'linear' });
    expect(err._tag).toBe('TrackerNotConfigured');
    expect(err.tracker).toBe('linear');
  });

  it('IssueNotFound has _tag and id field', () => {
    const err = new IssueNotFound({ id: 'MIN-1' });
    expect(err._tag).toBe('IssueNotFound');
    expect(err.id).toBe('MIN-1');
  });

  it('RateLimited has _tag and retryAfter field', () => {
    const err = new RateLimited({ retryAfter: 60 });
    expect(err._tag).toBe('RateLimited');
    expect(err.retryAfter).toBe(60);
  });

  it('TrackerApiError has _tag, tracker, and message fields', () => {
    const err = new TrackerApiError({ tracker: 'github', message: 'API error' });
    expect(err._tag).toBe('TrackerApiError');
    expect(err.tracker).toBe('github');
    expect(err.message).toBe('API error');
  });

  it('WorkspaceNotFound has _tag and id field', () => {
    const err = new WorkspaceNotFound({ id: 'PAN-1' });
    expect(err._tag).toBe('WorkspaceNotFound');
    expect(err.id).toBe('PAN-1');
  });

  it('WorkspaceCreateError has _tag, id, and message fields', () => {
    const err = new WorkspaceCreateError({ id: 'PAN-1', message: 'worktree failed' });
    expect(err._tag).toBe('WorkspaceCreateError');
    expect(err.message).toBe('worktree failed');
  });

  it('AgentAlreadyRunning has _tag and id field', () => {
    const err = new AgentAlreadyRunning({ id: 'PAN-1' });
    expect(err._tag).toBe('AgentAlreadyRunning');
    expect(err.id).toBe('PAN-1');
  });

  it('AgentStartError has _tag, id, and message fields', () => {
    const err = new AgentStartError({ id: 'PAN-1', message: 'spawn failed' });
    expect(err._tag).toBe('AgentStartError');
    expect(err.message).toBe('spawn failed');
  });
});

describe('Typed errors — Effect channel propagation', () => {
  it('Effect.catchTag can catch TrackerNotConfigured by tag', async () => {
    const program = Effect.fail(new TrackerNotConfigured({ tracker: 'github' })).pipe(
      Effect.catchTag('TrackerNotConfigured', (err) =>
        Effect.succeed(`handled: ${err.tracker}`),
      ),
    );

    const result = await runEffect(program);
    expect(result).toBe('handled: github');
  });

  it('Effect.catchTag can catch WorkspaceNotFound by tag', async () => {
    const program = Effect.fail(new WorkspaceNotFound({ id: 'PAN-1' })).pipe(
      Effect.catchTag('WorkspaceNotFound', (err) =>
        Effect.succeed(`workspace missing: ${err.id}`),
      ),
    );

    const result = await runEffect(program);
    expect(result).toBe('workspace missing: PAN-1');
  });

  it('Effect.catchTag lets non-matching errors pass through', async () => {
    const failed: Effect.Effect<never, IssueNotFound | TrackerNotConfigured> =
      Effect.fail(new IssueNotFound({ id: 'MIN-1' }));
    const program = failed.pipe(
      Effect.catchTag('TrackerNotConfigured', () => Effect.succeed('should not match')),
    );

    const err = await runEffectFail(program);
    expect((err as any)._tag).toBe('IssueNotFound');
  });

  it('Effect.catchTags catches multiple typed errors', async () => {
    const failed: Effect.Effect<never, RateLimited | TrackerApiError> =
      Effect.fail(new RateLimited({ retryAfter: 30 }));
    const program = failed.pipe(
      Effect.catchTags({
        RateLimited: (err) => Effect.succeed(`rate limited: ${err.retryAfter}s`),
        TrackerApiError: () => Effect.succeed('api error'),
      }),
    );

    const result = await runEffect(program);
    expect(result).toBe('rate limited: 30s');
  });

  it('multiple typed errors compose in the error channel', async () => {
    type Errors = TrackerNotConfigured | IssueNotFound | RateLimited;

    // Test that different typed errors can be in the same error channel
    const fail1 = Effect.fail(new TrackerNotConfigured({ tracker: 'linear' })) as Effect.Effect<never, Errors>;
    const fail2 = Effect.fail(new IssueNotFound({ id: 'MIN-1' })) as Effect.Effect<never, Errors>;

    // Catch the first, let the second propagate
    const combined = fail1.pipe(
      Effect.catchTag('TrackerNotConfigured', () => fail2),
    );

    const err = await runEffectFail(combined);
    expect((err as any)._tag).toBe('IssueNotFound');
  });

  it('BeadsNotInitialized has correct structure', () => {
    const err = new BeadsNotInitialized({ workspace: '/path/to/workspace' });
    expect(err._tag).toBe('BeadsNotInitialized');
    expect(err.workspace).toBe('/path/to/workspace');
  });

  it('errors are distinguishable via instanceof', () => {
    const err = new TrackerNotConfigured({ tracker: 'github' });
    expect(err instanceof TrackerNotConfigured).toBe(true);
    expect(err instanceof IssueNotFound).toBe(false);
  });

  it('error cause field is optional and preserved', () => {
    const cause = new Error('original cause');
    const err = new TrackerApiError({ tracker: 'github', message: 'wrapped', cause });
    expect(err.cause).toBe(cause);
  });
});
