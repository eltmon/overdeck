/**
 * PAN-5498: complete-planning journals `handoff.requested` before it sends
 * the post-planning spawn. When the dashboard dies mid-request (PAN-5469: a
 * slow stack rebuild, then a restart), that entry stays last, and
 * deacon-lite's deferred hand-off retry resumes the start.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notifyPipeline: vi.fn(),
}));

vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: mocks.notifyPipeline }));

const { appendPipelineEntry, readPipelineJournal } = await import('../pipeline-journal.js');
const { setCloisterEventStoreProvider } = await import('../event-store-provider.js');
const deferred = await import('../deferred-handoff.js');

const T0 = Date.parse('2026-11-17T12:29:40.000Z');
const MINUTE = 60_000;
const ISSUE = 'PAN-5469';

let workspace: string;
let spawn: ReturnType<typeof vi.fn>;
let emitActivity: ReturnType<typeof vi.fn>;
let getAgentState: ReturnType<typeof vi.fn>;
let readConsent: ReturnType<typeof vi.fn>;

function deps(): Parameters<typeof deferred.retryDeferredHandoffs>[1] {
  return {
    listWorkspaces: () => [{ id: 'ws1', issueId: ISSUE, path: workspace }] as never,
    liveAgentInventory: (async () => ({ backend: 'herdr', panes: [] })) as never,
    getAgentState: getAgentState as never,
    readConsent: readConsent as never,
    spawn: spawn as never,
    emitActivity: emitActivity as never,
  };
}

async function tick(minutes: number): Promise<string[]> {
  await vi.advanceTimersByTimeAsync(minutes * MINUTE);
  return deferred.retryDeferredHandoffs(Date.now(), deps());
}

function handoffTypes(): string[] {
  return readPipelineJournal(workspace).filter((entry) => entry.type.startsWith('handoff.')).map((entry) => entry.type);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  workspace = mkdtempSync(join(tmpdir(), 'pan-5498-requested-'));
  spawn = vi.fn(async () => ({ spawned: true, agentId: 'agent-pan-5469' }));
  emitActivity = vi.fn();
  getAgentState = vi.fn(() => null);
  readConsent = vi.fn(async () => true);
  setCloisterEventStoreProvider(() => ({ append: () => 1 }));
  deferred.recordHandoffRequested({ workspacePath: workspace, issueId: ISSUE });
});

afterEach(() => {
  setCloisterEventStoreProvider(null);
  vi.useRealTimers();
  rmSync(workspace, { recursive: true, force: true });
});

describe('retryDeferredHandoffs with a handoff.requested entry', () => {
  it('leaves an entry complete-planning journals during the consent read to the next scan', async () => {
    readConsent.mockImplementationOnce(async () => {
      appendPipelineEntry(workspace, { type: 'handoff.started', issueId: ISSUE, source: 'complete-planning', data: { agentId: 'agent-pan-5469' } });
      return true;
    });

    const actions = await tick(10);

    expect(spawn).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
    expect(handoffTypes()).toEqual(['handoff.requested', 'handoff.started']);
  });

  it('waits out the resume delay, then starts the work agent', async () => {
    await tick(9);
    expect(spawn).not.toHaveBeenCalled();

    const actions = await tick(1);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(ISSUE, 'planning-auto-handoff');
    expect(actions).toEqual([`retryDeferredHandoffs: ${ISSUE} started the work agent on retry 1`]);
    expect(handoffTypes()).toEqual(['handoff.requested', 'handoff.started']);
    expect(emitActivity).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('after the first start request was interrupted'),
    }));
  });

  it('keeps retrying on the backoff when the resumed start is refused', async () => {
    spawn.mockResolvedValueOnce({ spawned: false, skippedReason: 'stack-unhealthy', error: 'No Docker containers found' });

    await tick(10);
    expect(handoffTypes()).toEqual(['handoff.requested', 'handoff.retried']);

    await tick(4);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(handoffTypes().at(-1)).toBe('handoff.started');
  });

  it('follows the newer deferral when the original request answered with a refusal', async () => {
    deferred.recordHandoffDeferred({ workspacePath: workspace, issueId: ISSUE, error: 'Agent ceiling reached', reason: 'guardrails' });

    await tick(2);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(emitActivity).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('after the spawn guardrails cleared'),
    }));
  });

  it('never retries a request complete-planning closed as a plain failure', async () => {
    appendPipelineEntry(workspace, {
      type: 'handoff.abandoned',
      issueId: ISSUE,
      source: 'complete-planning',
      data: { outcome: 'failed', skipReason: 'spawn-failed', error: 'boom' },
    });

    await tick(30);

    expect(spawn).not.toHaveBeenCalled();
  });

  it('stands down when the original request did start the agent before the dashboard died', async () => {
    getAgentState.mockImplementation((id: string) => (id === 'agent-pan-5469'
      ? { startedAt: new Date(T0 + 30_000).toISOString() }
      : null));

    const actions = await tick(10);

    expect(spawn).not.toHaveBeenCalled();
    expect(actions[0]).toContain('stood down: the work agent was started after the deferral');
    expect(handoffTypes().at(-1)).toBe('handoff.abandoned');
  });
});
