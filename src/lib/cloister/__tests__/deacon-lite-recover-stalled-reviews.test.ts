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
  isAlive: vi.fn(),
  redispatchReviewSynthesis: vi.fn(),
}));

vi.mock('../../terminal-backends/inventory.js', () => ({ liveAgentInventory: mocks.liveAgentInventory }));
vi.mock('../../workspaces/resolver.js', () => ({ listWorkspaces: mocks.listWorkspaces }));
vi.mock('../review-convoy.js', () => ({ recoverMissingConvoyReviewers: mocks.recoverMissingConvoyReviewers }));
vi.mock('../request-review-pipeline.js', () => ({ getRequestReviewStarter: mocks.getRequestReviewStarter }));
vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: mocks.notifyPipeline }));
vi.mock('../../agents/liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents/liveness.js')>()),
  isAlive: mocks.isAlive,
}));
vi.mock('../review-agent.js', () => ({ redispatchReviewSynthesis: mocks.redispatchReviewSynthesis }));

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
  mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true });
  mocks.redispatchReviewSynthesis.mockResolvedValue({
    success: true, message: 'Synthesis recovery for PAN-3705 (deacon-lite): resumed agent-pan-3705-review for run r1',
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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

  // PAN-3914: the old checkOrphanedCompletions "recovered" one issue nine times
  // in 45 minutes. A recovery that launched nothing must not journal a
  // re-dispatch or report one, or the routine repeats that shape hourly.
  it('does not journal or report a convoy recovery that launched nothing', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    // No lane to relaunch, and not every lane has a report on disk (allReported unset).
    mocks.recoverMissingConvoyReviewers.mockResolvedValue({
      success: true, message: 'Convoy already launched for PAN-3705 run r1 — no-op',
    });

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(readPipelineJournal(workspace).map((entry) => entry.type)).toEqual(['review.dispatched']);

    // Nor does it re-probe the convoy on every tick.
    expect(await recoverStalledReviews(NOW + 30 * MINUTE)).toEqual([]);
    expect(mocks.recoverMissingConvoyReviewers).toHaveBeenCalledTimes(1);
  });

  // Synthesis recovery (#4134) acts only once every lane has its report on disk.
  // Until then the no-op branch must at least make a dead parent visible —
  // without an hourly false alarm on a parent still waiting on its lanes.
  describe('when no lane needs relaunching, not every report is on disk, and no verdict was posted', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
      mocks.recoverMissingConvoyReviewers.mockResolvedValue({
        success: true, message: 'Convoy already launched for PAN-3705 run r1 — no-op', runId: 'r1', allReported: false,
      });
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    const stallWarnings = () => warn.mock.calls.filter(([line]) => String(line).includes('synthesis parent'));

    it('warns once per cooldown when the synthesis parent is confirmed dead', async () => {
      mocks.isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });

      expect(await recoverStalledReviews(NOW)).toEqual([]);
      expect(mocks.isAlive).toHaveBeenCalledWith('agent-pan-3705-review');
      expect(stallWarnings()).toHaveLength(1);
      expect(String(stallWarnings()[0]?.[0])).toContain('PAN-3705');

      expect(await recoverStalledReviews(NOW + 30 * MINUTE)).toEqual([]);
      expect(stallWarnings()).toHaveLength(1);

      expect(await recoverStalledReviews(NOW + 61 * MINUTE)).toEqual([]);
      expect(stallWarnings()).toHaveLength(2);
      expect(readPipelineJournal(workspace).map((entry) => entry.type)).toEqual(['review.dispatched']);
      expect(mocks.redispatchReviewSynthesis).not.toHaveBeenCalled();
    });

    it('stays quiet while the synthesis parent is alive', async () => {
      mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true });

      expect(await recoverStalledReviews(NOW)).toEqual([]);
      expect(stallWarnings()).toHaveLength(0);
    });

    it('stays quiet when the liveness probe is indeterminate', async () => {
      mocks.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });

      expect(await recoverStalledReviews(NOW)).toEqual([]);
      expect(stallWarnings()).toHaveLength(0);
    });
  });

  it('keeps the hourly cooldown across a deacon restart, from the journal', async () => {
    vi.setSystemTime(NOW - 30 * MINUTE);
    appendPipelineEntry(workspace, { type: 'review.redispatched', issueId: 'PAN-3705', source: 'deacon-lite' });
    vi.setSystemTime(NOW);
    // A restarted deacon child has an empty in-memory cooldown map.
    __resetStalledReviewCooldownForTests();

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(mocks.recoverMissingConvoyReviewers).not.toHaveBeenCalled();
    expect(await recoverStalledReviews(NOW + 31 * MINUTE)).toHaveLength(1);
  });

  // The journal cooldown holds only while our own re-dispatch is the LAST
  // entry: a new request or dispatch after it is a new review, and a stall of
  // that one must not wait out the previous re-dispatch's hour.
  it.each(['review.requested', 'review.dispatched'])(
    'recovers again when a %s lands after a re-dispatch, inside its cooldown',
    async (type) => {
      journal([
        { type: 'review.redispatched', minutesAgo: 40 },
        { type, minutesAgo: 20 },
      ]);

      const actions = await recoverStalledReviews(NOW);

      expect(actions).toHaveLength(1);
      expect(mocks.recoverMissingConvoyReviewers).toHaveBeenCalledTimes(1);
      expect(readPipelineJournal(workspace).map((entry) => entry.type))
        .toEqual(['review.redispatched', type, 'review.redispatched']);
    },
  );

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

// #4134: every lane of the run reported, but the synthesis parent died before
// posting a verdict. Nothing relaunches a lane, so only the synthesis gate acts.
describe('recoverStalledReviews — synthesis recovery', () => {
  const RUN_ID = 'agent-pan-3705-review-abcd1234';

  function allLanesReported(): void {
    mocks.recoverMissingConvoyReviewers.mockResolvedValue({
      success: true,
      message: `Convoy already launched for PAN-3705 run ${RUN_ID} — no-op`,
      runId: RUN_ID,
      allReported: true,
    });
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
  }

  it('re-dispatches synthesis when every lane reported and the parent is confirmed dead, and journals it', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    allLanesReported();

    const actions = await recoverStalledReviews(NOW);

    expect(mocks.isAlive).toHaveBeenCalledWith('agent-pan-3705-review');
    expect(mocks.redispatchReviewSynthesis).toHaveBeenCalledWith('PAN-3705', {
      workspace, runId: RUN_ID, source: 'deacon-lite',
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('re-dispatched PAN-3705 via synthesis-recovery');
    const last = readPipelineJournal(workspace).at(-1);
    expect(last).toMatchObject({ type: 'review.redispatched', issueId: 'PAN-3705', source: 'deacon-lite' });
    expect(last?.data).toMatchObject({ via: 'synthesis-recovery', runId: RUN_ID });
  });

  it('takes no action while the parent liveness is unknown, and re-probes on the next tick', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    allLanesReported();
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(mocks.redispatchReviewSynthesis).not.toHaveBeenCalled();
    expect(readPipelineJournal(workspace).map((entry) => entry.type)).toEqual(['review.dispatched']);

    // An unknown answer buys no cooldown: once the probe answers "dead", it acts.
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'pane-dead' });
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(await recoverStalledReviews(NOW + MINUTE)).toHaveLength(1);
    expect(mocks.redispatchReviewSynthesis).toHaveBeenCalledTimes(1);
  });

  it('takes no action while the parent is alive', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    allLanesReported();
    mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true });

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(mocks.redispatchReviewSynthesis).not.toHaveBeenCalled();
  });

  it('takes no action when a verdict is already journaled for the run', async () => {
    // The verdict landed, then an older recovery entry is last — so the
    // last-entry rule lets the routine through and the verdict gate must hold.
    vi.setSystemTime(NOW - 120 * MINUTE);
    appendPipelineEntry(workspace, { type: 'review.dispatched', issueId: 'PAN-3705', data: { runId: RUN_ID } });
    vi.setSystemTime(NOW - 100 * MINUTE);
    appendPipelineEntry(workspace, { type: 'review.verdict', issueId: 'PAN-3705', data: { verdict: 'APPROVED', runId: RUN_ID } });
    vi.setSystemTime(NOW - 90 * MINUTE);
    appendPipelineEntry(workspace, { type: 'review.redispatched', issueId: 'PAN-3705', source: 'deacon-lite' });
    vi.setSystemTime(NOW);
    allLanesReported();

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(mocks.recoverMissingConvoyReviewers).toHaveBeenCalledTimes(1);
    expect(mocks.isAlive).not.toHaveBeenCalled();
    expect(mocks.redispatchReviewSynthesis).not.toHaveBeenCalled();
  });

  it('does not treat a verdict for an older run as a verdict for this run', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    vi.setSystemTime(NOW - 20 * MINUTE);
    appendPipelineEntry(workspace, {
      type: 'review.verdict', issueId: 'PAN-3705', data: { verdict: 'CHANGES_REQUESTED', runId: 'agent-pan-3705-review-00000000' },
    });
    vi.setSystemTime(NOW - 16 * MINUTE);
    appendPipelineEntry(workspace, { type: 'review.dispatched', issueId: 'PAN-3705', data: { runId: RUN_ID } });
    vi.setSystemTime(NOW);
    allLanesReported();

    expect(await recoverStalledReviews(NOW)).toHaveLength(1);
  });

  it('holds the cooldown after a synthesis re-dispatch, in memory and across a restart', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    allLanesReported();

    expect(await recoverStalledReviews(NOW)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(await recoverStalledReviews(NOW + 30 * MINUTE)).toEqual([]);

    // A restarted deacon child reads the cooldown back from its journal entry.
    __resetStalledReviewCooldownForTests();
    expect(await recoverStalledReviews(NOW + 30 * MINUTE)).toEqual([]);
    expect(mocks.redispatchReviewSynthesis).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(31 * MINUTE);
    expect(await recoverStalledReviews(NOW + 61 * MINUTE)).toHaveLength(1);
    expect(mocks.redispatchReviewSynthesis).toHaveBeenCalledTimes(2);
  });

  it('cools down after a failed synthesis re-dispatch instead of retrying every tick', async () => {
    journal([{ type: 'review.dispatched', minutesAgo: 30 }]);
    allLanesReported();
    mocks.redispatchReviewSynthesis.mockResolvedValue({ success: false, message: 'spawn failed' });

    expect(await recoverStalledReviews(NOW)).toEqual([]);
    expect(await recoverStalledReviews(NOW + MINUTE)).toEqual([]);
    expect(mocks.redispatchReviewSynthesis).toHaveBeenCalledTimes(1);
    expect(readPipelineJournal(workspace).map((entry) => entry.type)).toEqual(['review.dispatched']);
  });
});
