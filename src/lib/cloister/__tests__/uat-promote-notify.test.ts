import { describe, expect, it, vi } from 'vitest';
import { FLYWHEEL_ORCHESTRATOR_AGENT_ID } from '../flywheel.js';
import { notifyFlywheelOfUatPromote, type NotifyDeps } from '../uat-promote-notify.js';
import type { PromoteResult } from '../uat-promote.js';

function successfulPromote(overrides: Partial<Extract<PromoteResult, { success: true }>> = {}): Extract<PromoteResult, { success: true }> {
  return {
    success: true,
    generation: 'uat/pan-cobalt-0703',
    mergeSha: 'abc123def456',
    members: ['PAN-2260', 'PAN-2294'],
    postMergeStarted: ['PAN-2260', 'PAN-2294'],
    invalidated: ['uat/pan-slate-0703'],
    ...overrides,
  };
}

function deps(overrides: NotifyDeps = {}): Required<NotifyDeps> {
  return {
    getActiveRunId: vi.fn(() => 'RUN-1'),
    isPaused: vi.fn(() => false),
    sessionExists: vi.fn(() => true),
    message: vi.fn(async () => undefined),
    recordNudge: vi.fn(),
    ...overrides,
  };
}

describe('notifyFlywheelOfUatPromote', () => {
  it('delivers a nudge and records delivered=true when the flywheel run is active and live', async () => {
    const d = deps();

    await notifyFlywheelOfUatPromote(successfulPromote(), d);

    expect(d.message).toHaveBeenCalledOnce();
    expect(d.message).toHaveBeenCalledWith(
      FLYWHEEL_ORCHESTRATOR_AGENT_ID,
      expect.stringContaining('Run a fresh Observe->Act loop NOW'),
      'uat-promote-notify',
    );
    expect(d.message).toHaveBeenCalledWith(
      FLYWHEEL_ORCHESTRATOR_AGENT_ID,
      expect.stringContaining('EXCLUDE the merged member(s): PAN-2260, PAN-2294'),
      'uat-promote-notify',
    );
    expect(d.message).toHaveBeenCalledWith(
      FLYWHEEL_ORCHESTRATOR_AGENT_ID,
      expect.stringContaining('GET /api/registered-projects'),
      'uat-promote-notify',
    );
    expect(d.message).toHaveBeenCalledWith(
      FLYWHEEL_ORCHESTRATOR_AGENT_ID,
      expect.stringContaining('GET /api/pipeline/membership?project=<URL-encoded-project-key>'),
      'uat-promote-notify',
    );
    expect(d.message).toHaveBeenCalledWith(
      FLYWHEEL_ORCHESTRATOR_AGENT_ID,
      expect.stringContaining('only rows where inPipeline === true'),
      'uat-promote-notify',
    );
    expect(d.recordNudge).toHaveBeenCalledWith({
      source: 'cloister',
      level: 'info',
      issueId: 'PAN-2260',
      message: 'uat-promote-notify: told flywheel-orchestrator to re-derive its ready set after a UAT promote',
      details: JSON.stringify({
        generation: 'uat/pan-cobalt-0703',
        members: ['PAN-2260', 'PAN-2294'],
        mergeSha: 'abc123def456',
        delivered: true,
      }),
    });
  });

  it('records delivered=false without messaging when the orchestrator session is absent', async () => {
    const d = deps({ sessionExists: vi.fn(() => false) });

    await notifyFlywheelOfUatPromote(successfulPromote(), d);

    expect(d.message).not.toHaveBeenCalled();
    expect(d.recordNudge).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining('"delivered":false'),
    }));
  });

  it.each([
    ['failed promote', { success: false, reason: 'not-found', message: 'missing' } satisfies PromoteResult, deps()],
    ['no active run', successfulPromote(), deps({ getActiveRunId: vi.fn(() => null) })],
    ['paused flywheel', successfulPromote(), deps({ isPaused: vi.fn(() => true) })],
  ])('returns without side effects for %s', async (_name, result, d) => {
    await notifyFlywheelOfUatPromote(result, d);

    expect(d.message).not.toHaveBeenCalled();
    expect(d.recordNudge).not.toHaveBeenCalled();
  });

  it('swallows message failures and still resolves', async () => {
    const d = deps({ message: vi.fn(async () => { throw new Error('delivery failed'); }) });

    await expect(notifyFlywheelOfUatPromote(successfulPromote(), d)).resolves.toBeUndefined();

    expect(d.recordNudge).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining('"delivered":true'),
    }));
  });
});
