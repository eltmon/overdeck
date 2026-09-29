/**
 * deacon-lite's deferred planning hand-off retry (PAN-4155).
 *
 * A spawn guardrail refused the post-planning work-agent start. The retry
 * re-sends it with no acknowledgement on a backoff read from the pipeline
 * journal, stands down when the operator acted, and gives up after two hours
 * with `planning.failed` and an activity warning.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notifyPipeline: vi.fn(),
  getInternalToken: vi.fn(() => 'test-internal-token'),
}));

vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: mocks.notifyPipeline }));
vi.mock('../../internal-token.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../internal-token.js')>()),
  getInternalToken: mocks.getInternalToken,
}));

const { readPipelineJournal } = await import('../pipeline-journal.js');
const { setCloisterEventStoreProvider } = await import('../event-store-provider.js');
const deferred = await import('../deferred-handoff.js');

const T0 = Date.parse('2026-09-24T10:00:00.000Z');
const MINUTE = 60_000;
const ISSUE = 'PAN-4155';

let workspace: string;
let spawn: ReturnType<typeof vi.fn>;
let emitActivity: ReturnType<typeof vi.fn>;
let getAgentState: ReturnType<typeof vi.fn>;
let readConsent: ReturnType<typeof vi.fn>;
let liveAgentInventory: ReturnType<typeof vi.fn>;
let appended: Array<{ type: string; payload: Record<string, unknown> }>;

function deps(): Parameters<typeof deferred.retryDeferredHandoffs>[1] {
  return {
    listWorkspaces: () => [{ id: 'ws1', issueId: ISSUE, path: workspace }] as never,
    liveAgentInventory: liveAgentInventory as never,
    getAgentState: getAgentState as never,
    readConsent: readConsent as never,
    spawn: spawn as never,
    emitActivity: emitActivity as never,
  };
}

const refused = { spawned: false, skippedReason: 'guardrails', error: 'Agent ceiling reached' };

/** Advance the fake clock one deacon-lite interval and run one pass. */
async function tick(minutes = 1): Promise<string[]> {
  await vi.advanceTimersByTimeAsync(minutes * MINUTE);
  return deferred.retryDeferredHandoffs(Date.now(), deps());
}

function handoffEntries() {
  return readPipelineJournal(workspace).filter((entry) => entry.type.startsWith('handoff.'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  workspace = mkdtempSync(join(tmpdir(), 'pan-4155-retry-'));
  spawn = vi.fn(async () => refused);
  emitActivity = vi.fn();
  getAgentState = vi.fn(() => null);
  readConsent = vi.fn(async () => true);
  liveAgentInventory = vi.fn(async () => ({ backend: 'herdr', panes: [] }));
  appended = [];
  setCloisterEventStoreProvider(() => ({
    append: (event) => {
      appended.push(event as unknown as { type: string; payload: Record<string, unknown> });
      return appended.length;
    },
  }));
  deferred.recordHandoffDeferred({ workspacePath: workspace, issueId: ISSUE, error: 'Agent ceiling reached', httpStatus: 429 });
});

afterEach(() => {
  setCloisterEventStoreProvider(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  rmSync(workspace, { recursive: true, force: true });
});

describe('retryDeferredHandoffs', () => {
  it('retries on the backoff and stops once the spawn goes through', async () => {
    await tick(1); // T0+1: backoff not elapsed
    expect(spawn).not.toHaveBeenCalled();

    await tick(1); // T0+2: first retry, refused
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(ISSUE, 'planning-auto-handoff');
    const retried = handoffEntries().at(-1)!;
    expect(retried).toMatchObject({ type: 'handoff.retried', source: 'deacon-lite', data: { attempt: 1, skipReason: 'guardrails' } });
    expect(Date.parse(String(retried.data!['nextRetryAt']))).toBe(T0 + 6 * MINUTE);

    await tick(3); // T0+5: second retry not due yet
    expect(spawn).toHaveBeenCalledTimes(1);

    spawn.mockResolvedValueOnce({ spawned: true, agentId: 'agent-pan-4155' });
    await tick(1); // T0+6: second retry, accepted
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(handoffEntries().at(-1)).toMatchObject({ type: 'handoff.started', data: { attempt: 2, agentId: 'agent-pan-4155' } });
    expect(emitActivity).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('after the spawn guardrails cleared'),
    }));

    await tick(30);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(appended).toEqual([]);
  });

  it('resumes the schedule from the journal after a restart', async () => {
    await tick(2); // first retry at T0+2, refused
    expect(spawn).toHaveBeenCalledTimes(1);

    // A fresh module instance holds no memory of the earlier pass.
    vi.resetModules();
    const restarted = await import('../deferred-handoff.js');
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    await restarted.retryDeferredHandoffs(Date.now(), deps()); // T0+5: not due
    expect(spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MINUTE);
    await restarted.retryDeferredHandoffs(Date.now(), deps()); // T0+6: due
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('gives up after two hours, records planning.failed and warns in activity', async () => {
    for (let minute = 0; minute < 125; minute += 1) await tick(1);

    // Retries at 2, 6, 14, 30, 50, 70, 90 and 110 minutes.
    expect(spawn).toHaveBeenCalledTimes(8);
    const abandoned = handoffEntries().at(-1)!;
    expect(abandoned).toMatchObject({ type: 'handoff.abandoned', data: { outcome: 'gave-up', attempt: 8, skipReason: 'guardrails' } });
    expect(handoffEntries().filter((entry) => entry.type === 'handoff.abandoned')).toHaveLength(1);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ type: 'planning.failed', payload: { issueId: ISSUE, stage: 'auto-handoff', workAgentSkipReason: 'guardrails' } });
    expect(emitActivity).toHaveBeenCalledWith(expect.objectContaining({
      source: 'plan',
      level: 'warn',
      issueId: ISSUE,
      message: expect.stringContaining(`pan start ${ISSUE}`),
    }));
  });

  it.each([
    ['a live work agent', () => liveAgentInventory.mockResolvedValue({ backend: 'herdr', panes: [{ agentId: 'agent-pan-4155' }] })],
    ['a running work agent the operator started', () => getAgentState.mockImplementation((id: string) => (
      id === 'agent-pan-4155' ? { id, status: 'running', startedAt: new Date(T0 + MINUTE).toISOString() } : null))],
    ['a work agent the operator stopped', () => getAgentState.mockImplementation((id: string) => (
      id === 'agent-pan-4155'
        ? { id, status: 'stopped', startedAt: new Date(T0 - 60 * MINUTE).toISOString(), stoppedAt: new Date(T0 + MINUTE).toISOString() }
        : null))],
    ['a paused issue', () => getAgentState.mockImplementation((id: string) => (
      id === 'agent-pan-4155' ? { id, status: 'stopped', paused: true, startedAt: new Date(T0 - 60 * MINUTE).toISOString() } : null))],
    ['a spent auto-start consent', () => readConsent.mockResolvedValue(false)],
    ['a planning session restarted after the deferral', () => getAgentState.mockImplementation((id: string) => (
      id === 'planning-pan-4155' ? { id, status: 'running', startedAt: new Date(T0 + MINUTE).toISOString() } : null))],
  ])('stands down without retrying for %s', async (_label, arrange) => {
    arrange();
    await tick(2);

    expect(spawn).not.toHaveBeenCalled();
    expect(handoffEntries().at(-1)).toMatchObject({ type: 'handoff.abandoned', data: { outcome: 'stood-down' } });
    expect(appended).toEqual([]);

    await tick(10);
    expect(handoffEntries().filter((entry) => entry.type === 'handoff.abandoned')).toHaveLength(1);
  });

  it('stands down when the retried spawn reports the agent paused', async () => {
    spawn.mockResolvedValueOnce({ spawned: false, skippedReason: 'paused', error: 'Agent is paused' });
    await tick(2);

    expect(handoffEntries().at(-1)).toMatchObject({ type: 'handoff.abandoned', data: { outcome: 'stood-down' } });
    expect(appended).toEqual([]);
  });

  it('retries when the planning label still reads running from before the deferral', async () => {
    getAgentState.mockImplementation((id: string) => (
      id === 'planning-pan-4155' ? { id, status: 'running', startedAt: new Date(T0 - 30 * MINUTE).toISOString() } : null));
    await tick(2);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(handoffEntries().at(-1)).toMatchObject({ type: 'handoff.retried' });
  });

  it('retries when a work label reads running with no live pane and an older start', async () => {
    getAgentState.mockImplementation((id: string) => (
      id === 'agent-pan-4155' ? { id, status: 'running', startedAt: new Date(T0 - 60 * MINUTE).toISOString() } : null));
    await tick(2);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(handoffEntries().at(-1)).toMatchObject({ type: 'handoff.retried' });
  });

  it('does nothing while the backend inventory is unreadable', async () => {
    liveAgentInventory.mockResolvedValue(null);
    await tick(5);

    expect(spawn).not.toHaveBeenCalled();
    expect(handoffEntries().map((entry) => entry.type)).toEqual(['handoff.deferred']);
  });

  // PAN-3634: the retry carries the planning chain's own provenance, not a
  // hardcoded literal — Flywheel-started planning hands off as flywheel:conv-flywheel.
  it('re-sends the spawn with the planning session\'s Flywheel provenance when it was Flywheel-started', async () => {
    getAgentState.mockImplementation((id: string) => (
      id === 'planning-pan-4155' ? { id, startedBy: 'flywheel:conv-flywheel' } : null
    ));

    await tick(2); // T0+2: first retry, refused

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(ISSUE, 'flywheel:conv-flywheel');
  });

  it('re-sends the spawn with no guardrail acknowledgement', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      blocked: true,
      error: 'Agent ceiling reached',
      guardrails: { blocked: true, status: 429 },
    }), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const { spawn: _unused, ...withoutSpawn } = deps()!;
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    await deferred.retryDeferredHandoffs(Date.now(), withoutSpawn);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [unknown, RequestInit])[1].body));
    expect(body).toEqual({
      issueId: ISSUE,
      role: 'work',
      startedBy: 'planning-auto-handoff',
      autoSpawnConsentRequired: true,
    });
    expect(handoffEntries().at(-1)).toMatchObject({ type: 'handoff.retried', data: { skipReason: 'guardrails' } });
  });

  it('stands down when the retried spawn reports the agent already starting or running', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      error: 'Agent agent-pan-4155 is already starting or running.',
      code: 'AGENT_START_IN_FLIGHT',
    }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const { spawn: _unused, ...withoutSpawn } = deps()!;
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    await deferred.retryDeferredHandoffs(Date.now(), withoutSpawn);

    expect(handoffEntries().at(-1)).toMatchObject({ type: 'handoff.abandoned', data: { outcome: 'stood-down' } });
    expect(appended).toEqual([]);
  });

  // PAN-4399: a `stack-unhealthy` deferral carries its reason through every
  // journal entry in the retry chain, distinct from a guardrail refusal.
  describe('a stack-unhealthy deferral', () => {
    beforeEach(() => {
      deferred.recordHandoffDeferred({
        workspacePath: workspace,
        issueId: ISSUE,
        error: 'Docker stack unhealthy',
        reason: 'stack-unhealthy',
      });
    });

    it('retries and carries reason: stack-unhealthy forward on refusal', async () => {
      spawn.mockResolvedValueOnce({ spawned: false, skippedReason: 'stack-unhealthy', error: 'Docker stack unhealthy' });

      await tick(2); // T0+2: first retry, refused

      expect(spawn).toHaveBeenCalledTimes(1);
      const retried = handoffEntries().at(-1)!;
      expect(retried).toMatchObject({
        type: 'handoff.retried',
        data: { attempt: 1, reason: 'stack-unhealthy', skipReason: 'stack-unhealthy' },
      });
      expect(Date.parse(String(retried.data!['nextRetryAt']))).toBeGreaterThan(T0 + 2 * MINUTE);
    });

    it('starts the work agent once the spawn succeeds, journals requestedAt, and names the stack recovery', async () => {
      spawn.mockResolvedValueOnce({ spawned: true, agentId: 'agent-pan-4155' });

      await tick(2); // T0+2: first retry, accepted

      const started = handoffEntries().at(-1)!;
      expect(started).toMatchObject({ type: 'handoff.started', data: { attempt: 1, agentId: 'agent-pan-4155' } });
      expect(typeof started.data!['requestedAt']).toBe('string');
      // PAN-4399 review fix: requestedAt is stamped before the spawn call, so
      // it is no later than the entry's own `at`.
      expect(Date.parse(String(started.data!['requestedAt']))).toBeLessThanOrEqual(Date.parse(started.at));
      expect(emitActivity).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('after the workspace docker stack recovered'),
      }));
    });

    it('gives up after two hours with skipReason stack-unhealthy and a pan start warning', async () => {
      spawn.mockResolvedValue({ spawned: false, skippedReason: 'stack-unhealthy', error: 'Docker stack unhealthy' });

      for (let minute = 0; minute < 125; minute += 1) await tick(1);

      const abandoned = handoffEntries().at(-1)!;
      expect(abandoned).toMatchObject({
        type: 'handoff.abandoned',
        data: { outcome: 'gave-up', skipReason: 'stack-unhealthy' },
      });
      expect(emitActivity).toHaveBeenCalledWith(expect.objectContaining({
        source: 'plan',
        level: 'warn',
        issueId: ISSUE,
        message: expect.stringContaining(`pan start ${ISSUE}`),
      }));
    });
  });
});
