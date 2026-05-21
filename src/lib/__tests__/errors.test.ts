/**
 * Unit tests for src/lib/errors.ts (PAN-1249 wave-0).
 *
 * Verifies that every exported Data.TaggedError subclass:
 * - can be constructed with its documented fields
 * - carries the correct `_tag` discriminant
 * - can be caught and narrowed inside an Effect channel
 */

import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import {
  VcsError,
  VcsTimeoutError,
  FsError,
  FsNotFoundError,
  GitError,
  MergeConflictError,
  TmuxError,
  TrackerError,
  GitHubApiError,
  LinearApiError,
  CheckpointError,
  InvalidAgentIdError,
  ConfigError,
  ConfigParseError,
  ProcessSpawnError,
  ProcessTimeoutError,
} from '../errors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run an Effect that is expected to fail and return the error. */
function runFail<E>(eff: Effect.Effect<never, E, never>): E {
  return Effect.runSync(Effect.flip(eff));
}

/** Catch a specific tag and return its message field (or tag name on miss). */
function catchTag<E extends { _tag: string }>(
  eff: Effect.Effect<never, E, never>,
  tag: E['_tag'],
): string {
  return Effect.runSync(
    Effect.catchTag(eff as Effect.Effect<never, any, never>, tag, (e) =>
      Effect.succeed(`caught:${(e as { _tag: string })._tag}`),
    ),
  ) as string;
}

// ─── VCS ─────────────────────────────────────────────────────────────────────

describe('VcsError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new VcsError({ operation: 'push', message: 'remote rejected' });
    expect(err._tag).toBe('VcsError');
    expect(err.operation).toBe('push');
    expect(err.message).toBe('remote rejected');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new VcsError({ operation: 'push', message: 'remote rejected' }));
    expect(catchTag(eff, 'VcsError')).toBe('caught:VcsError');
  });

  it('is narrowed correctly via _tag guard', () => {
    const err = runFail(Effect.fail(new VcsError({ operation: 'pull', message: 'auth failed' })));
    expect(err._tag).toBe('VcsError');
    if (err._tag === 'VcsError') {
      expect(err.operation).toBe('pull');
    }
  });
});

describe('VcsTimeoutError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new VcsTimeoutError({ operation: 'clone', timeoutMs: 30000 });
    expect(err._tag).toBe('VcsTimeoutError');
    expect(err.timeoutMs).toBe(30000);
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new VcsTimeoutError({ operation: 'clone', timeoutMs: 30000 }));
    expect(catchTag(eff, 'VcsTimeoutError')).toBe('caught:VcsTimeoutError');
  });
});

// ─── Filesystem ───────────────────────────────────────────────────────────────

describe('FsError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new FsError({ path: '/tmp/foo', operation: 'read', cause: new Error('EACCES') });
    expect(err._tag).toBe('FsError');
    expect(err.path).toBe('/tmp/foo');
    expect(err.operation).toBe('read');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new FsError({ path: '/tmp/foo', operation: 'write' }));
    expect(catchTag(eff, 'FsError')).toBe('caught:FsError');
  });
});

describe('FsNotFoundError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new FsNotFoundError({ path: '/missing/file' });
    expect(err._tag).toBe('FsNotFoundError');
    expect(err.path).toBe('/missing/file');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new FsNotFoundError({ path: '/missing/file' }));
    expect(catchTag(eff, 'FsNotFoundError')).toBe('caught:FsNotFoundError');
  });
});

// ─── Git ──────────────────────────────────────────────────────────────────────

describe('GitError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new GitError({ command: ['commit', '-m', 'msg'], stderr: 'nothing to commit', exitCode: 1 });
    expect(err._tag).toBe('GitError');
    expect(err.exitCode).toBe(1);
    expect(err.command).toEqual(['commit', '-m', 'msg']);
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new GitError({ command: ['push'], stderr: 'rejected', exitCode: 128 }));
    expect(catchTag(eff, 'GitError')).toBe('caught:GitError');
  });
});

describe('MergeConflictError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new MergeConflictError({
      branch: 'feature/x',
      targetBranch: 'main',
      conflictedFiles: ['src/foo.ts', 'src/bar.ts'],
    });
    expect(err._tag).toBe('MergeConflictError');
    expect(err.conflictedFiles).toHaveLength(2);
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(
      new MergeConflictError({ branch: 'feature/x', targetBranch: 'main', conflictedFiles: [] }),
    );
    expect(catchTag(eff, 'MergeConflictError')).toBe('caught:MergeConflictError');
  });
});

// ─── Tmux ─────────────────────────────────────────────────────────────────────

describe('TmuxError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new TmuxError({ command: 'new-session -s foo', message: 'session already exists' });
    expect(err._tag).toBe('TmuxError');
    expect(err.command).toBe('new-session -s foo');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new TmuxError({ command: 'kill-session', message: 'no such session' }));
    expect(catchTag(eff, 'TmuxError')).toBe('caught:TmuxError');
  });
});

// ─── Tracker / API ────────────────────────────────────────────────────────────

describe('TrackerError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new TrackerError({ tracker: 'linear', operation: 'updateIssue', message: 'forbidden' });
    expect(err._tag).toBe('TrackerError');
    expect(err.tracker).toBe('linear');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(
      new TrackerError({ tracker: 'github', operation: 'createIssue', message: 'rate limited' }),
    );
    expect(catchTag(eff, 'TrackerError')).toBe('caught:TrackerError');
  });
});

describe('GitHubApiError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new GitHubApiError({ operation: 'listPRs', status: 403, message: 'forbidden' });
    expect(err._tag).toBe('GitHubApiError');
    expect(err.status).toBe(403);
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new GitHubApiError({ operation: 'mergePR', status: 422, message: 'conflict' }));
    expect(catchTag(eff, 'GitHubApiError')).toBe('caught:GitHubApiError');
  });
});

describe('LinearApiError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new LinearApiError({ operation: 'updateState', message: 'network error' });
    expect(err._tag).toBe('LinearApiError');
    expect(err.operation).toBe('updateState');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new LinearApiError({ operation: 'getIssue', message: 'not found' }));
    expect(catchTag(eff, 'LinearApiError')).toBe('caught:LinearApiError');
  });
});

// ─── Agent / checkpoint ───────────────────────────────────────────────────────

describe('CheckpointError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new CheckpointError({ agentId: 'agent-pan-123', operation: 'save', message: 'disk full' });
    expect(err._tag).toBe('CheckpointError');
    expect(err.agentId).toBe('agent-pan-123');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(
      new CheckpointError({ agentId: 'agent-pan-123', operation: 'load', message: 'missing' }),
    );
    expect(catchTag(eff, 'CheckpointError')).toBe('caught:CheckpointError');
  });
});

describe('InvalidAgentIdError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new InvalidAgentIdError({ agentId: 'bad-id' });
    expect(err._tag).toBe('InvalidAgentIdError');
    expect(err.agentId).toBe('bad-id');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new InvalidAgentIdError({ agentId: '' }));
    expect(catchTag(eff, 'InvalidAgentIdError')).toBe('caught:InvalidAgentIdError');
  });
});

// ─── Configuration ────────────────────────────────────────────────────────────

describe('ConfigError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new ConfigError({ message: 'PANOPTICON_HOME not set' });
    expect(err._tag).toBe('ConfigError');
    expect(err.message).toBe('PANOPTICON_HOME not set');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new ConfigError({ message: 'missing key' }));
    expect(catchTag(eff, 'ConfigError')).toBe('caught:ConfigError');
  });
});

describe('ConfigParseError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new ConfigParseError({ path: 'projects.yaml', message: 'unexpected token' });
    expect(err._tag).toBe('ConfigParseError');
    expect(err.path).toBe('projects.yaml');
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new ConfigParseError({ path: 'settings.json', message: 'invalid JSON' }));
    expect(catchTag(eff, 'ConfigParseError')).toBe('caught:ConfigParseError');
  });
});

// ─── Process ──────────────────────────────────────────────────────────────────

describe('ProcessSpawnError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new ProcessSpawnError({ command: 'git', args: ['push'], message: 'ENOENT' });
    expect(err._tag).toBe('ProcessSpawnError');
    expect(err.command).toBe('git');
    expect(err.args).toEqual(['push']);
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new ProcessSpawnError({ command: 'bun', args: ['run', 'build'], message: 'spawn failed' }));
    expect(catchTag(eff, 'ProcessSpawnError')).toBe('caught:ProcessSpawnError');
  });
});

describe('ProcessTimeoutError', () => {
  it('constructs and carries the correct _tag', () => {
    const err = new ProcessTimeoutError({ command: 'npm', args: ['test'], timeoutMs: 60000 });
    expect(err._tag).toBe('ProcessTimeoutError');
    expect(err.timeoutMs).toBe(60000);
  });

  it('can be caught by _tag in an Effect channel', () => {
    const eff = Effect.fail(new ProcessTimeoutError({ command: 'eslint', args: ['.'], timeoutMs: 30000 }));
    expect(catchTag(eff, 'ProcessTimeoutError')).toBe('caught:ProcessTimeoutError');
  });
});

// ─── Multi-error channel narrowing ───────────────────────────────────────────

describe('multi-tag channel narrowing', () => {
  it('catches only the matching tag in a union channel', () => {
    type UnionErr = VcsError | FsNotFoundError;
    const eff: Effect.Effect<never, UnionErr, never> = Effect.fail(
      new FsNotFoundError({ path: '/lost' }),
    );

    const result = Effect.runSync(
      Effect.gen(function* () {
        return yield* Effect.catchTag(eff, 'FsNotFoundError', (e) =>
          Effect.succeed(`recovered:${e.path}`),
        );
      }),
    );

    expect(result).toBe('recovered:/lost');
  });

  it('propagates unmatched tag through the channel', () => {
    type UnionErr = VcsError | FsError;
    const eff: Effect.Effect<never, UnionErr, never> = Effect.fail(
      new VcsError({ operation: 'fetch', message: 'timeout' }),
    );

    const err = Effect.runSync(
      Effect.flip(
        Effect.catchTag(eff, 'FsError', () => Effect.succeed('should not reach')),
      ),
    );

    expect(err._tag).toBe('VcsError');
  });
});
