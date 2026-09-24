/**
 * Tests for review-monitor.ts (PAN-1059)
 */
import { describe, expect, it, vi } from 'vitest';
import { join } from 'path';

// ── fs/promises mock ───────────────────────────────────────────────────────
const mockStat = vi.fn();
vi.mock('fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
}));

// ── fs (sync) mock ─────────────────────────────────────────────────────────
const mockExistsSync = vi.fn(() => false);
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// ── tmux mocks ─────────────────────────────────────────────────────────────
const mockSessionExists = vi.fn();
const mockIsPaneDead = vi.fn();
vi.mock('../../tmux.js', () => ({
  sessionExists: (...args: unknown[]) => mockSessionExists(...args),
  sessionExistsSync: (...args: unknown[]) => mockSessionExists(...args),
  isPaneDead: (...args: unknown[]) => mockIsPaneDead(...args),
}));

import { reviewerOutputPath, REVIEW_SUB_ROLES  } from '../review-monitor.js';

const WORKSPACE = '/workspace';
const RUN_ID = 'agent-pan-1059-review-abc12345';

describe('reviewerOutputPath', () => {
  it('returns correct path for each sub-role', () => {
    expect(reviewerOutputPath(WORKSPACE, RUN_ID, 'security')).toBe(
      join(WORKSPACE, '.pan', 'review', RUN_ID, 'security.md'),
    );
    expect(reviewerOutputPath(WORKSPACE, RUN_ID, 'correctness')).toBe(
      join(WORKSPACE, '.pan', 'review', RUN_ID, 'correctness.md'),
    );
  });
});

describe('REVIEW_SUB_ROLES', () => {
  it('contains exactly the four expected roles', () => {
    expect([...REVIEW_SUB_ROLES]).toEqual(['security', 'correctness', 'performance', 'requirements']);
  });
});

