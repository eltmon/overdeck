/**
 * Tests for exactSession() — tmux target-session exact-match normalization.
 *
 * tmux matches a bare `-t <name>` target as a *prefix*: `has-session -t
 * agent-pan-977` succeeds when only `agent-pan-977-review` exists,
 * `kill-session -t agent-pan-977` kills `agent-pan-977-review`, etc. Prefixing
 * the name with `=` forces an exact-name match. This regression locks that in.
 */
import { describe, it, expect } from 'vitest';
import { exactSession } from '../../src/lib/tmux.js';

describe('exactSession', () => {
  it('prefixes a bare session name with =', () => {
    expect(exactSession('agent-pan-977')).toBe('=agent-pan-977');
  });

  it('is idempotent — does not double-prefix an already-exact target', () => {
    expect(exactSession('=agent-pan-977')).toBe('=agent-pan-977');
  });

  it('disambiguates a name that is a prefix of another session', () => {
    // The bug: `agent-pan-977` prefix-matches `agent-pan-977-review`.
    // exactSession() makes the two distinct, exact targets.
    expect(exactSession('agent-pan-977')).not.toBe(exactSession('agent-pan-977-review'));
    expect(exactSession('agent-pan-977')).toBe('=agent-pan-977');
    expect(exactSession('agent-pan-977-review')).toBe('=agent-pan-977-review');
  });
});
