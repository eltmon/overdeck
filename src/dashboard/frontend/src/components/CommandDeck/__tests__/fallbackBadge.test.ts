import { describe, expect, it } from 'vitest';

import { fallbackBadgeTone, type FallbackBadgeInput } from '../fallbackBadge';

const CREATED_AT = '2026-08-14T10:00:00.000Z';

function conv(overrides: Partial<FallbackBadgeInput> = {}): FallbackBadgeInput {
  return {
    forkStatus: null,
    status: 'active',
    sessionAlive: false,
    createdAt: CREATED_AT,
    lastActivityAt: null,
    ...overrides,
  };
}

describe('fallbackBadgeTone (PAN-3736)', () => {
  it('stays red while the fork is still provisioning', () => {
    for (const forkStatus of ['summarizing', 'spawning', 'injecting']) {
      expect(fallbackBadgeTone(conv({ forkStatus }))).toBe('alert');
    }
  });

  it('stays red when the fork failed', () => {
    expect(fallbackBadgeTone(conv({ forkStatus: 'failed' }))).toBe('alert');
  });

  it('downgrades to a note for an active conversation with a live session', () => {
    expect(fallbackBadgeTone(conv({ sessionAlive: true }))).toBe('note');
  });

  it('downgrades to a note when the transcript moved after creation', () => {
    expect(
      fallbackBadgeTone(conv({ lastActivityAt: '2026-08-14T11:30:00.000Z' })),
    ).toBe('note');
  });

  it('stays red for an active conversation that never showed a sign of life', () => {
    // No session, and the transcript has not moved since the row was created —
    // the degraded seed may well be why. Keep shouting.
    expect(fallbackBadgeTone(conv({ lastActivityAt: CREATED_AT }))).toBe('alert');
    expect(fallbackBadgeTone(conv({ lastActivityAt: null }))).toBe('alert');
  });

  it('stays red once the conversation has ended', () => {
    expect(fallbackBadgeTone(conv({ status: 'ended', sessionAlive: false }))).toBe('alert');
  });

  it('treats an unparseable timestamp as no activity rather than as health', () => {
    expect(fallbackBadgeTone(conv({ lastActivityAt: 'not-a-date' }))).toBe('alert');
    expect(
      fallbackBadgeTone(conv({ createdAt: 'not-a-date', lastActivityAt: '2026-08-14T11:30:00.000Z' })),
    ).toBe('alert');
  });
});
