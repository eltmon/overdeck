/**
 * Tests for exactSession() — tmux target-session exact-match normalization.
 *
 * tmux matches a bare `-t <name>` target as a *prefix*: `has-session -t
 * agent-pan-977` succeeds when only `agent-pan-977-review` exists,
 * `kill-session -t agent-pan-977` kills `agent-pan-977-review`, etc. Prefixing
 * the name with `=` forces an exact-name match. This regression locks that in.
 */
import { describe, it, expect } from 'vitest';
import { exactSession, exactPaneTarget } from '../../src/lib/tmux.js';

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

describe('exactPaneTarget', () => {
  // `capture-pane`/`list-panes` take a *pane* target. The `=name` session-exact
  // form is NOT a valid pane target — `capture-pane -t '=name'` fails with
  // "can't find pane". The pane target needs a window/pane component, so the
  // exact form is `=name:` (session named exactly <name>, active window/pane).
  // Regression: PAN-977's exact-match commit used `=name` for capture-pane and
  // silently broke every capturePaneAsync() call (all returned '').
  it('produces a valid pane target with a trailing colon', () => {
    expect(exactPaneTarget('conv-20260514-1194')).toBe('=conv-20260514-1194:');
  });

  it('does not produce the bare =name session form that capture-pane rejects', () => {
    expect(exactPaneTarget('conv-x')).not.toBe('=conv-x');
    expect(exactPaneTarget('conv-x')).toBe('=conv-x:');
  });

  it('is idempotent on an already-exact pane target', () => {
    expect(exactPaneTarget('=conv-x:')).toBe('=conv-x:');
  });

  it('appends the colon when given a bare =name', () => {
    expect(exactPaneTarget('=conv-x')).toBe('=conv-x:');
  });

  it('disambiguates a name that is a prefix of another session', () => {
    expect(exactPaneTarget('agent-pan-977')).not.toBe(exactPaneTarget('agent-pan-977-review'));
  });
});
