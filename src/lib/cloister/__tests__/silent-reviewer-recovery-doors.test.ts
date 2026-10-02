/**
 * PAN-4433: the default lane re-dispatch door of recoverSilentReviewers.
 *
 * The routine tests inject every door; this file runs the real
 * `redispatchLane` default against mocked backend, agent and convoy modules,
 * so the close → stop → reset → relaunch sequence and its failure answers are
 * pinned. A convoy recovery that launches nothing (its lane's report file
 * already exists) is a failed re-dispatch and must escalate.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../agents/agent-state-read.js';

const mocks = vi.hoisted(() => ({
  notifyPipeline: vi.fn(),
  emitActivityEntry: vi.fn(),
  closeAgentPaneDetailed: vi.fn(),
  stopAgent: vi.fn(),
  removeAgentStateDir: vi.fn(),
  recoverMissingConvoyReviewers: vi.fn(),
}));

vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: mocks.notifyPipeline }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));
vi.mock('../../terminal-backends/launch.js', () => ({ closeAgentPaneDetailed: mocks.closeAgentPaneDetailed }));
vi.mock('../../agents.js', () => ({
  listAgentStates: vi.fn(() => []),
  stopAgent: (agentId: string) => Effect.promise(() => mocks.stopAgent(agentId)),
}));
vi.mock('../../agents/state-dir-removal.js', () => ({ removeAgentStateDir: mocks.removeAgentStateDir }));
vi.mock('../review-convoy.js', () => ({ recoverMissingConvoyReviewers: mocks.recoverMissingConvoyReviewers }));

const { readPipelineJournal } = await import('../pipeline-journal.js');
const { recoverSilentReviewers, __resetSilentReviewerStateForTests } = await import('../silent-reviewer-recovery.js');

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const MINUTE = 60_000;
const ISSUE = 'PAN-4383';
const LANE = 'agent-pan-4383-review-security';
const RUN = 'agent-pan-4383-review-0e9e390c';

let workspace: string;

function lane(): AgentState {
  return {
    id: LANE,
    issueId: ISSUE,
    workspace,
    role: 'review',
    model: 'review-model',
    status: 'running',
    startedAt: new Date(NOW - 60 * MINUTE).toISOString(),
    reviewSubRole: 'security',
    reviewRunId: RUN,
    reviewDispatchedAt: new Date(NOW - 16 * MINUTE).toISOString(),
  } as AgentState;
}

/** Every dep except redispatchLane, so the real lane door runs. */
function deps() {
  const state = lane();
  return {
    listReviewStates: () => [state],
    readState: (agentId: string) => (agentId === LANE ? state : null),
    isAlive: async () => ({ alive: true as const, paneAlive: true as const, backendState: 'idle' as const }),
    transcriptActivityMs: async () => null,
    reportMtimeMs: () => null,
    currentRunId: async () => RUN,
    stallMs: () => 15 * MINUTE,
    getIssuePause: () => ({ status: 'unpaused' as const }),
    resumeGateAllows: () => true,
    redispatchParent: vi.fn(),
    surfaceNeedsYou: vi.fn(async () => undefined),
  };
}

function entries(type: string) {
  return readPipelineJournal(workspace).filter((entry) => entry.type === type);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetSilentReviewerStateForTests();
  workspace = mkdtempSync(join(tmpdir(), 'silent-reviewer-doors-'));
  mocks.closeAgentPaneDetailed.mockResolvedValue({ outcome: 'closed' });
  mocks.stopAgent.mockResolvedValue(undefined);
  mocks.removeAgentStateDir.mockResolvedValue({ removedFiles: 1, preservedTranscripts: 1, removedDir: true });
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(workspace, { recursive: true, force: true });
});

describe('default redispatchLane door', () => {
  it('closes, stops and resets the lane, then relaunches it through the convoy door', async () => {
    mocks.recoverMissingConvoyReviewers.mockResolvedValue({ success: true, launched: 1, runId: RUN, message: 'launched 1/1 missing reviewer(s)' });
    const d = deps();

    const actions = await recoverSilentReviewers(NOW, d);

    expect(actions).toEqual([`recoverSilentReviewers: re-dispatched silent ${LANE} for ${ISSUE} — launched 1/1 missing reviewer(s)`]);
    expect(mocks.closeAgentPaneDetailed).toHaveBeenCalledWith(LANE);
    expect(mocks.stopAgent).toHaveBeenCalledWith(LANE);
    expect(mocks.removeAgentStateDir).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${LANE}$`)));
    expect(mocks.recoverMissingConvoyReviewers).toHaveBeenCalledWith(ISSUE, { source: 'silent-reviewer-recovery' });
    expect(mocks.closeAgentPaneDetailed.mock.invocationCallOrder[0]).toBeLessThan(mocks.removeAgentStateDir.mock.invocationCallOrder[0]!);
    expect(mocks.removeAgentStateDir.mock.invocationCallOrder[0]).toBeLessThan(mocks.recoverMissingConvoyReviewers.mock.invocationCallOrder[0]!);
    expect(entries('review.stall-escalated')).toHaveLength(0);
    expect(d.surfaceNeedsYou).not.toHaveBeenCalled();
  });

  it('escalates when the convoy door launches nothing (the lane report file already exists)', async () => {
    mocks.recoverMissingConvoyReviewers.mockResolvedValue({
      success: true,
      runId: RUN,
      allReported: false,
      message: `Convoy already launched for ${ISSUE} run ${RUN} — no-op`,
    });
    const d = deps();

    await recoverSilentReviewers(NOW, d);

    expect(entries('review.stalled')).toHaveLength(1);
    const escalated = entries('review.stall-escalated');
    expect(escalated).toHaveLength(1);
    expect(escalated[0]?.data?.reason).toContain('re-dispatch failed:');
    expect(escalated[0]?.data?.reason).toContain('no-op');
    expect(d.surfaceNeedsYou).toHaveBeenCalledTimes(1);
  });

  it('escalates without touching state when the pane cannot be closed', async () => {
    mocks.closeAgentPaneDetailed.mockResolvedValue({ outcome: 'failed', reason: 'herdr socket down' });
    const d = deps();

    await recoverSilentReviewers(NOW, d);

    expect(mocks.removeAgentStateDir).not.toHaveBeenCalled();
    expect(mocks.recoverMissingConvoyReviewers).not.toHaveBeenCalled();
    expect(entries('review.stall-escalated')[0]?.data?.reason).toBe(`re-dispatch failed: could not close ${LANE}: herdr socket down`);
    expect(d.surfaceNeedsYou).toHaveBeenCalledTimes(1);
  });
});
