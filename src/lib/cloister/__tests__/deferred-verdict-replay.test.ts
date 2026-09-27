/**
 * PAN-4263: deacon-lite replays a review verdict that a transient forge
 * failure kept off the PR, through the same CLI door, under the original caller.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  emitActivityEntry: vi.fn(),
  notifyPipeline: vi.fn(),
}));

vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));
vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: mocks.notifyPipeline }));

const { appendPipelineEntry, lastPipelineEntry, readPipelineJournal } = await import('../pipeline-journal.js');
const { replayDeferredReviewVerdict } = await import('../deferred-verdict-replay.js');

const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const MINUTE = 60_000;
const ISSUE = 'PAN-4222';
const RUN_ID = 'agent-pan-4222-review-abcdef12';

let workspace: string;
const execFile = vi.fn();
const getAgentState = vi.fn();

function defer(minutesAgo: number, data: Record<string, unknown> = {}): void {
  vi.setSystemTime(NOW - minutesAgo * MINUTE);
  appendPipelineEntry(workspace, {
    type: 'review.verdict-deferred',
    issueId: ISSUE,
    source: 'pan-specialists-done',
    data: {
      status: 'passed',
      runId: RUN_ID,
      notes: 'three files checked',
      callerId: 'agent-pan-4222-review',
      reason: 'API rate limit exceeded',
      ...data,
    },
  });
  vi.setSystemTime(NOW);
}

function replay() {
  const entry = lastPipelineEntry(workspace);
  if (!entry) throw new Error('no journal entry');
  return replayDeferredReviewVerdict(ISSUE, workspace, entry, NOW, { execFile, getAgentState });
}

const gaveUp = () => readPipelineJournal(workspace).filter((entry) => entry.type === 'review.verdict-replay-gave-up');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  workspace = mkdtempSync(join(tmpdir(), 'deferred-verdict-replay-'));
  getAgentState.mockReturnValue({ reviewRunId: RUN_ID });
  execFile.mockImplementation(async () => {
    appendPipelineEntry(workspace, { type: 'review.verdict', issueId: ISSUE, data: { verdict: 'APPROVED' } });
    return { stdout: '', stderr: '' };
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(workspace, { recursive: true, force: true });
});

describe('replayDeferredReviewVerdict (PAN-4263)', () => {
  it('waits until the deferral is ten minutes old', async () => {
    defer(5);

    await expect(replay()).resolves.toBeNull();

    expect(execFile).not.toHaveBeenCalled();
    expect(gaveUp()).toEqual([]);
  });

  it('replays through pan admin specialists done under the original review caller', async () => {
    defer(11);

    const action = await replay();

    expect(action).toContain('recorded the deferred passed review verdict for PAN-4222');
    expect(execFile).toHaveBeenCalledWith(
      'pan',
      ['admin', 'specialists', 'done', 'review', ISSUE, '--status', 'passed', '--run-id', RUN_ID, '--notes', 'three files checked'],
      expect.objectContaining({ timeout: 5 * 60_000 }),
    );
    expect(execFile.mock.calls[0][2].env.OVERDECK_AGENT_ID).toBe('agent-pan-4222-review');
  });

  it('replays an operator verdict with no agent identity in the environment', async () => {
    vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-9999');
    vi.stubEnv('OVERDECK_ISSUE_ID', 'PAN-9999');
    vi.stubEnv('OVERDECK_SESSION_TYPE', 'work');
    defer(11, { callerId: null });

    await replay();

    const env = execFile.mock.calls[0][2].env as NodeJS.ProcessEnv;
    expect(env).not.toHaveProperty('OVERDECK_AGENT_ID');
    expect(env).not.toHaveProperty('OVERDECK_ISSUE_ID');
    expect(env).not.toHaveProperty('OVERDECK_SESSION_TYPE');
    vi.unstubAllEnvs();
  });

  it('gives up without replaying when a newer review run superseded the verdict', async () => {
    getAgentState.mockReturnValue({ reviewRunId: 'agent-pan-4222-review-99999999' });
    defer(11);

    await replay();

    expect(execFile).not.toHaveBeenCalled();
    expect(gaveUp()).toEqual([expect.objectContaining({ data: { runId: RUN_ID, reason: 'superseded' } })]);
  });

  it('gives up and warns the operator once the run has been deferred seven times', async () => {
    for (let minutesAgo = 80; minutesAgo >= 20; minutesAgo -= 10) defer(minutesAgo);

    await replay();

    expect(execFile).not.toHaveBeenCalled();
    expect(gaveUp()).toEqual([expect.objectContaining({ data: { runId: RUN_ID, reason: 'cap' } })]);
    expect(mocks.emitActivityEntry).toHaveBeenCalledTimes(1);
    expect(mocks.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      issueId: ISSUE,
      message: expect.stringContaining('could not be recorded after 7 attempts'),
    }));
  });

  it('gives up when the replay fails without deferring again', async () => {
    execFile.mockRejectedValue(Object.assign(new Error('Command failed'), { stderr: 'HTTP 401: Bad credentials' }));
    defer(11);

    await expect(replay()).resolves.toBeNull();

    expect(gaveUp()).toEqual([expect.objectContaining({ data: { runId: RUN_ID, reason: 'failed' } })]);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(expect.stringContaining('HTTP 401: Bad credentials'));
  });

  it('leaves a fresh deferral as the next cooldown when the replay hits another transient failure', async () => {
    execFile.mockImplementation(async () => {
      appendPipelineEntry(workspace, {
        type: 'review.verdict-deferred',
        issueId: ISSUE,
        data: { status: 'passed', runId: RUN_ID, callerId: 'agent-pan-4222-review', reason: 'rate limit' },
      });
      throw Object.assign(new Error('Command failed'), { stderr: 'rate limit' });
    });
    defer(11);

    await expect(replay()).resolves.toBeNull();

    expect(gaveUp()).toEqual([]);
    expect(lastPipelineEntry(workspace)?.type).toBe('review.verdict-deferred');
  });

  it('does nothing for an overlapping tick while a replay is in flight', async () => {
    let release: () => void = () => {};
    execFile.mockImplementation(() => new Promise((resolve) => {
      release = () => {
        appendPipelineEntry(workspace, { type: 'review.verdict', issueId: ISSUE });
        resolve({ stdout: '', stderr: '' });
      };
    }));
    defer(11);

    const first = replay();
    await expect(replay()).resolves.toBeNull();
    release();
    await first;

    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
