/**
 * deacon-lite's one recovery routine (PAN-3939).
 *
 * A dashboard restart mid-convoy lost the convoy and nothing re-dispatched it;
 * a dead reviewer pane blocked re-dispatch forever. The journal's LAST entry
 * decides, so the rules that keep this from thrashing — a later
 * `verification.*` or `merge.*` entry, a live sub-reviewer, the hourly
 * cooldown — are what these cases pin down.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  liveAgentInventory: vi.fn(),
  listWorkspaces: vi.fn(),
  recoverMissingConvoyReviewers: vi.fn(),
  getRequestReviewStarter: vi.fn(),
  notifyPipeline: vi.fn(),
  getIssuePause: vi.fn(),
}));

vi.mock('../../terminal-backends/inventory.js', () => ({ liveAgentInventory: mocks.liveAgentInventory }));
vi.mock('../../workspaces/resolver.js', () => ({ listWorkspaces: mocks.listWorkspaces }));
vi.mock('../review-convoy.js', () => ({ recoverMissingConvoyReviewers: mocks.recoverMissingConvoyReviewers }));
vi.mock('../request-review-pipeline.js', () => ({ getRequestReviewStarter: mocks.getRequestReviewStarter }));
vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: mocks.notifyPipeline }));
vi.mock('../../agents/agent-state.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents/agent-state.js')>()),
  getIssuePause: mocks.getIssuePause,
}));

const { appendPipelineEntry, readPipelineJournal } = await import('../pipeline-journal.js');
const { recoverStalledReviews, __resetStalledReviewCooldownForTests } = await import('../deacon-lite.js');

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const MINUTE = 60_000;

let workspace: string;

/** Append with a chosen timestamp — the journal stamps `at` itself. */
function journal(entries: Array<{ type: string; minutesAgo: number }>): void {
  for (const { type, minutesAgo } of entries) {
    vi.setSystemTime(NOW - minutesAgo * MINUTE);
    appendPipelineEntry(workspace, { type: type as never, issueId: 'PAN-3705' });
  }
  vi.setSystemTime(NOW);
}

function oneWorkspace() {
  return [{ id: 'ws1', issueId: 'PAN-3705', path: workspace }];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetStalledReviewCooldownForTests();
  workspace = mkdtempSync(join(tmpdir(), 'deacon-lite-reviews-'));
  mocks.liveAgentInventory.mockResolvedValue({ backend: 'herdr', panes: [] });
  mocks.listWorkspaces.mockReturnValue(oneWorkspace());
  mocks.recoverMissingConvoyReviewers.mockResolvedValue({
    success: true, message: 'Convoy recovery for PAN-3705 (deacon-lite): launched 4/4 missing reviewer(s)', launched: 4,
  });
  mocks.getIssuePause.mockReturnValue({ status: 'unpaused' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(workspace, { recursive: true, force: true });
});

describe('recoverStalledReviews', () => {
  it('re-dispatches a stale dispatched convoy with no live reviewer, and journals it', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);

    const actions = await recoverStalledReviews(NOW);

    expect(mocks.recoverMissingConvoyReviewers).toHaveBeenCalledWith('PAN-3705', { source: 'deacon-lite' });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('re-dispatched PAN-3705 via convoy-recovery');
    const last = readPipelineJournal(workspace).at(-1);
    expect(last).toMatchObject({ type: 'review.redispatched', issueId: 'PAN-3705', source: 'deacon-lite' });
    expect(last?.data).toMatchObject({ via: 'convoy-recovery' });
  });

  it('recovers a review that was requested but never dispatched', async () => {
    journal([{ type: 'review.requested', minutesAgo: 40 }]);
    const actions = await recoverStalledReviews(NOW);
    expect(actions).toHaveLength(1);
  });

  it('leaves a fresh request alone', async () => {
    journal([{ type: 'review.requested', minutesAgo: 3 }]);

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(mocks.recoverMissingConvoyReviewers).not.toHaveBeenCalled();
  });

  it('leaves the convoy alone while a sub-reviewer pane is live', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    mocks.liveAgentInventory.mockResolvedValue({
      backend: 'herdr',
      panes: [{ agentId: 'agent-pan-3705-review-security' }],
    });

    expect(await recoverStalledReviews(NOW)).toEqual([]);
  });

  it('does not let a live synthesis parent mask four dead lanes', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    // The parent's id is exactly `agent-<issue>-review` — it is not a reviewer.
    mocks.liveAgentInventory.mockResolvedValue({
      backend: 'herdr',
      panes: [{ agentId: 'agent-pan-3705-review' }],
    });

    expect(await recoverStalledReviews(NOW)).toHaveLength(1);
  });

  it('skips when a verification entry landed after the review request', async () => {
    journal([
      { type: 'review.requested', minutesAgo: 60 },
      { type: 'verification.failed', minutesAgo: 40 },
    ]);

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(mocks.recoverMissingConvoyReviewers).not.toHaveBeenCalled();
  });

  it('skips when the issue already moved on to merge', async () => {
    journal([
      { type: 'review.dispatched', minutesAgo: 90 },
      { type: 'merge.attempted', minutesAgo: 40 },
    ]);

    expect(await recoverStalledReviews(NOW)).toEqual([]);
  });

  it('skips a posted verdict', async () => {
    journal([
      { type: 'review.dispatched', minutesAgo: 90 },
      { type: 'review.verdict', minutesAgo: 40 },
    ]);

    expect(await recoverStalledReviews(NOW)).toEqual([]);
  });

  it('honours the one-per-hour cooldown', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);

    expect(await recoverStalledReviews(NOW)).toHaveLength(1);
    expect(await recoverStalledReviews(NOW + 30 * MINUTE)).toEqual([]);
    expect(await recoverStalledReviews(NOW + 61 * MINUTE)).toHaveLength(1);
  });

  it('falls back to the full review door when the parent has no run state', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    mocks.recoverMissingConvoyReviewers.mockResolvedValue({
      success: false, message: 'No review parent state for PAN-3705 — cannot recover reviewers',
    });
    const startReview = vi.fn(async () => ({ started: true as const }));
    mocks.getRequestReviewStarter.mockReturnValue(startReview);

    const actions = await recoverStalledReviews(NOW);

    expect(startReview).toHaveBeenCalledWith('PAN-3705', expect.objectContaining({ source: 'deacon-lite' }));
    expect(actions[0]).toContain('via request-review');
    expect(readPipelineJournal(workspace).at(-1)?.data).toMatchObject({ via: 'request-review' });
  });

  it('does not re-dispatch a paused issue, and logs the pause once (PAN-3911)', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    mocks.getIssuePause.mockReturnValue({
      status: 'paused', agentId: 'agent-pan-3705', pausedAt: '2026-09-19T11:00:00.000Z', pausedReason: 'cut token spend',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(await recoverStalledReviews(NOW + 2 * MINUTE)).toEqual([]);

    expect(mocks.getIssuePause).toHaveBeenCalledWith('PAN-3705');
    expect(mocks.recoverMissingConvoyReviewers).not.toHaveBeenCalled();
    expect(mocks.getRequestReviewStarter).not.toHaveBeenCalled();
    expect(readPipelineJournal(workspace).at(-1)?.type).toBe('review.dispatched');
    const pauseLines = log.mock.calls.filter(([line]) => String(line).includes('PAN-3705 is paused'));
    expect(pauseLines).toHaveLength(1);
    expect(String(pauseLines[0]?.[0])).toContain('cut token spend');
  });

  it('holds an issue whose pause state cannot be read, and logs it once (PAN-3911)', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    mocks.getIssuePause.mockReturnValue({ status: 'unknown', agentId: 'agent-pan-3705', reason: 'state.json is unparsable' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(await recoverStalledReviews(NOW + MINUTE)).toEqual([]);

    expect(mocks.recoverMissingConvoyReviewers).not.toHaveBeenCalled();
    expect(log.mock.calls.filter(([line]) => String(line).includes('unreadable pause state'))).toHaveLength(1);
  });

  it('does not recover a review the issue pause halted, even once unpaused (PAN-3911)', async () => {
    // The pause stopped the synthesis parent; convoy recovery would relaunch
    // lanes that report to it. Unpause re-requests the review instead.
    journal([{ type: 'review.dispatched', minutesAgo: 60 }, { type: 'review.halted', minutesAgo: 30 }]);

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(mocks.recoverMissingConvoyReviewers).not.toHaveBeenCalled();
    expect(mocks.getRequestReviewStarter).not.toHaveBeenCalled();
  });

  it('does nothing when the backend inventory cannot be read', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    mocks.liveAgentInventory.mockResolvedValue(null);

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(mocks.recoverMissingConvoyReviewers).not.toHaveBeenCalled();
  });

  it('ignores a workspace whose path is gone', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    mocks.listWorkspaces.mockReturnValue([{ id: 'ws1', issueId: 'PAN-3705', path: join(workspace, 'missing') }]);

    expect(await recoverStalledReviews(NOW)).toEqual([]);
  });
});
