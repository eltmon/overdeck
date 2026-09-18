import { describe, expect, it, vi } from 'vitest';

// W1 deleted src/lib/state-read-home.ts and src/lib/state-home.ts; W3 deletes
// the record plane and the mirror syncs that import them. They are still on
// this module's import chain in this tree, so stub the importers rather than
// loading them. Every entry here disappears once W3 lands.
vi.mock('../../../../../lib/pan-dir/record.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/record-update.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/record-list.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/records.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/records-backfill.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/auto-commit.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/agents.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/push-health.js', () => ({}));
vi.mock('../../../../../lib/overdeck/review-status-record-sync.js', () => ({}));
vi.mock('../../../../../lib/remote-workspace.js', () => ({}));
vi.mock('../../../../../lib/remote/remote-agents.js', () => ({}));
vi.mock('../../../../../lib/state-auto-migrate.js', () => ({}));
vi.mock('../../../../../lib/memory/state-mirror.js', () => ({}));
vi.mock('../../../../../lib/overdeck/planning-promotion.js', () => ({}));
vi.mock('../../../../../lib/overdeck/conversation-retrospective.js', () => ({}));
vi.mock('../../../../../lib/orders/dispatch-gate.js', () => ({}));
vi.mock('../../../../../lib/orders/dispatch-reservation.js', () => ({}));
vi.mock('../../../../../lib/cloister/flywheel.js', () => ({}));
vi.mock('../../../../../lib/cloister/state-recreation-patrol.js', () => ({}));
vi.mock('../../../../../lib/agents/spawn.js', () => ({ spawnRun: vi.fn(), spawnAgent: vi.fn(), spawnRunPromise: vi.fn() }));
vi.mock('../../../../../lib/agents.js', () => ({ transitionIssueToInReview: vi.fn(), spawnRun: vi.fn() }));



import { parseRequestedReviewMode } from '../review-pipeline.js';

describe('parseRequestedReviewMode', () => {
  it.each(['quick', 'full', 'none'] as const)('accepts %s', (reviewMode) => {
    expect(parseRequestedReviewMode({ reviewMode })).toEqual({ ok: true, mode: reviewMode });
  });

  it('accepts an absent or null reviewMode without returning a mode', () => {
    expect(parseRequestedReviewMode({})).toEqual({ ok: true });
    expect(parseRequestedReviewMode({ reviewMode: null })).toEqual({ ok: true });
  });

  it.each(['FULL', '', 123, {}])('rejects invalid reviewMode %j', (reviewMode) => {
    const result = parseRequestedReviewMode({ reviewMode });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('quick, full, or none');
    }
  });
});
