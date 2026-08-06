import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agents.js', () => ({
  spawnRun: vi.fn(async () => ({ id: 'agent-pan-503-test' })),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'overdeck', projectPath: '/tmp/overdeck' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'overdeck', projectPath: '/tmp/overdeck' })),
}));

vi.mock('../../review-status.js', () => ({
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
}));

vi.mock('../merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: vi.fn(async () => ({ skip: false, reason: 'open' })),
  verifyMergedBeforeLifecycle: vi.fn(),
}));

import { spawnRun } from '../../agents.js';
import { resolveProjectFromIssueSync } from '../../projects.js';
import { setReviewStatusSync } from '../../review-status.js';
import { buildTestRolePrompt, dispatchTestAgentAndNotify } from '../test-agent-queue.js';

describe('test role dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a test role prompt that folds UAT into the test role', () => {
    const prompt = buildTestRolePrompt({
      issueId: 'PAN-503',
      workspace: '/tmp/workspace',
      branch: 'feature/pan-503',
    });

    expect(prompt).toContain('TEST TASK for PAN-503');
    expect(prompt).toContain('use the Playwright MCP tools available to the test role');
    expect(prompt).toContain('Do not spawn or wake a separate UAT agent');
    expect(prompt).toContain('pan admin specialists done test PAN-503');
    expect(prompt).toContain('--status passed');
    expect(prompt).toContain('--uat-status failed');
    expect(prompt).toContain('A required UAT that cannot run or leaves any criterion unproven is uatStatus "failed"');
    expect(prompt).not.toContain('readyForMerge');
    expect(prompt).toContain('Do NOT spawn, wake, or delegate to test-agent or uat-agent specialists');
  });

  it('points test roles at durable records instead of retired workspace-local planning files', () => {
    const prompt = buildTestRolePrompt({ issueId: 'PAN-503' });

    expect(prompt).toContain('.pan/records/pan-503.json');
    expect(prompt).toContain('the canonical xBRIEF under .pan/specs/ for PAN-503');
    expect(prompt).toContain('Do not require retired workspace-local .pan/continue.json or .pan/spec.vbrief.json files to exist.');
    expect(prompt).not.toContain('Read .pan/continue.json');
    expect(prompt).not.toContain('Read .pan/spec.vbrief.json');
  });

  it('instructs the test role to write the .pan/test/result.json verdict artifact before signaling (PAN-1681)', () => {
    const prompt = buildTestRolePrompt({ issueId: 'PAN-503' });

    // The verdict artifact write is a required step with the exact shape the
    // deacon failsafe (checkCompletedButUnsignaledTests) reads back.
    expect(prompt).toContain('.pan/test/result.json');
    expect(prompt).toContain('{"status":"passed","notes":');
    expect(prompt).toContain('"uatStatus":"passed","uatNotes":');

    // It must come before the trusted CLI signal so the verdict survives an interruption.
    const artifactIdx = prompt.indexOf('.pan/test/result.json');
    const signalIdx = prompt.indexOf('pan admin specialists done test PAN-503');
    expect(artifactIdx).toBeGreaterThan(-1);
    expect(signalIdx).toBeGreaterThan(-1);
    expect(artifactIdx).toBeLessThan(signalIdx);
  });

  it('tells the test role one CLI signal attempt is enough, with the artifact as the durable copy (PAN-3092)', () => {
    const prompt = buildTestRolePrompt({ issueId: 'PAN-503' });

    // MIN-902 burned ~$5/hr re-signalling a verdict that was already durable.
    expect(prompt).toContain('Make exactly ONE CLI signal attempt');
    expect(prompt).toContain('do NOT retry the signal in a loop');
    // The instruction must point at the step-8 artifact as the surviving copy.
    const oneAttemptIdx = prompt.indexOf('Make exactly ONE CLI signal attempt');
    expect(prompt.slice(oneAttemptIdx)).toContain('.pan/test/result.json');
  });

  it('starts spawnRun(issueId, test) and marks testing', async () => {
    const notifyAgent = vi.fn(async () => {});

    await Effect.runPromise(dispatchTestAgentAndNotify('PAN-503', '/tmp/workspace', 'feature/pan-503', notifyAgent));

    expect(spawnRun).toHaveBeenCalledWith('PAN-503', 'test', expect.objectContaining({
      workspace: '/tmp/workspace',
      prompt: expect.stringContaining('TEST TASK for PAN-503'),
    }));
    expect(setReviewStatusSync).toHaveBeenCalledWith('PAN-503', { testStatus: 'testing' });
    expect(notifyAgent).toHaveBeenCalledWith(
      'agent-pan-503',
      expect.stringContaining('The test role has been dispatched automatically'),
    );
  });

  it('does not spawn when no project is configured', async () => {
    vi.mocked(resolveProjectFromIssueSync).mockReturnValueOnce(null);

    await Effect.runPromise(dispatchTestAgentAndNotify('PAN-503', '/tmp/workspace', 'feature/pan-503'));

    expect(spawnRun).not.toHaveBeenCalled();
    expect(setReviewStatusSync).toHaveBeenCalledWith('PAN-503', {
      testStatus: 'dispatch_failed',
      testNotes: 'No project configured for PAN-503. Add it to projects.yaml.',
    });
  });
});
