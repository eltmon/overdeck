/**
 * PAN-1742: a vanished session is not always a crash. The review convoy
 * lenses + synthesis and the test role complete-and-exit (and never save a
 * session), so the crash handler must not count them as crashes or schedule
 * doomed restarts.
 */
import { describe, it, expect } from 'vitest';
import { nonRestartableReason } from '../../../../src/lib/cloister/service.js';

describe('nonRestartableReason (PAN-1742)', () => {
  it('treats one-shot convoy roles as completions, with or without a session', () => {
    expect(nonRestartableReason('review', undefined)).toMatch(/one-shot run/);
    expect(nonRestartableReason('test', undefined)).toMatch(/one-shot run/);
    // Even if a one-shot role somehow carried a session, its exit is still a completion.
    expect(nonRestartableReason('review', 'sess-123')).toMatch(/one-shot run/);
  });

  it('skips any role that has no resumable session (restart would fail)', () => {
    expect(nonRestartableReason('work', undefined)).toMatch(/no resumable session/);
    expect(nonRestartableReason('plan', undefined)).toMatch(/no resumable session/);
    expect(nonRestartableReason('ship', undefined)).toMatch(/no resumable session/);
  });

  it('returns null for a genuine restart candidate: resumable persistent role', () => {
    expect(nonRestartableReason('work', 'sess-abc')).toBeNull();
    expect(nonRestartableReason('plan', 'sess-def')).toBeNull();
    expect(nonRestartableReason('ship', 'sess-ghi')).toBeNull();
  });
});
