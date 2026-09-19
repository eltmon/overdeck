import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agents.js', () => ({
  spawnRun: vi.fn(async () => ({ id: 'agent-pan-503-test' })),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'overdeck', projectPath: '/tmp/overdeck' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'overdeck', projectPath: '/tmp/overdeck' })),
}));

const prFacts = vi.hoisted(() => ({
  getPrFacts: vi.fn(async (issueId: string) => ({
    issueId, forge: 'github', url: 'https://github.com/o/r/pull/1', number: 1,
    exists: true, open: true, merged: false, closed: false, draft: false,
    headSha: 'abc', headBranch: 'feature/pan-503', reviewDecision: 'APPROVED',
    approved: true, changesRequested: false, mergeable: true, mergeableState: 'mergeable',
    checks: 'green' as const,
  })),
}));
vi.mock('../pr-facts.js', () => prFacts);

import { spawnRun } from '../../agents.js';
import { resolveProjectFromIssueSync } from '../../projects.js';
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
    expect(prompt).toContain('Do NOT spawn, wake, or delegate to test-agent or uat-agent specialists');
  });

  it('points test roles at the plan and its continue file, never a record (PAN-3917)', () => {
    const prompt = buildTestRolePrompt({ issueId: 'PAN-503' });

    expect(prompt).toContain('the canonical xBRIEF under .pan/specs/ for PAN-503');
    expect(prompt).toContain('.pan/continues/PAN-503.xbrief.json');
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

  it('starts spawnRun(issueId, test) and writes no status', async () => {
    const notifyAgent = vi.fn(async () => {});

    const result = await Effect.runPromise(
      dispatchTestAgentAndNotify('PAN-503', '/tmp/workspace', 'feature/pan-503', notifyAgent),
    );

    expect(spawnRun).toHaveBeenCalledWith('PAN-503', 'test', expect.objectContaining({
      workspace: '/tmp/workspace',
      prompt: expect.stringContaining('TEST TASK for PAN-503'),
    }));
    expect(result).toMatchObject({ delivered: true, notified: true });
    expect(notifyAgent).toHaveBeenCalledWith(
      'agent-pan-503',
      expect.stringContaining('The test role has been dispatched automatically'),
    );
  });

  it('does not spawn when no project is configured', async () => {
    vi.mocked(resolveProjectFromIssueSync).mockReturnValueOnce(null);

    const result = await Effect.runPromise(
      dispatchTestAgentAndNotify('PAN-503', '/tmp/workspace', 'feature/pan-503'),
    );

    expect(spawnRun).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: false, notified: false, reason: 'no-project' });
  });

  it('PAN-3917 (FR-8): does not dispatch until the issue has an open pull request', async () => {
    prFacts.getPrFacts.mockResolvedValueOnce({
      issueId: 'PAN-503', forge: null, url: null, number: null, exists: false,
      open: false, merged: false, closed: false, draft: false, headSha: null,
      headBranch: null, reviewDecision: null, approved: false, changesRequested: false,
      mergeable: null, mergeableState: null, checks: 'none' as const,
    } as never);

    const result = await Effect.runPromise(dispatchTestAgentAndNotify('PAN-503', '/tmp/workspace'));

    expect(spawnRun).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: false, notified: false, reason: 'no-open-pr' });
  });

  it('does not dispatch once the pull request merged', async () => {
    prFacts.getPrFacts.mockResolvedValueOnce({
      issueId: 'PAN-503', forge: 'github', url: 'https://github.com/o/r/pull/1', number: 1,
      exists: true, open: false, merged: true, closed: false, draft: false, headSha: 'abc',
      headBranch: 'feature/pan-503', reviewDecision: 'APPROVED', approved: true,
      changesRequested: false, mergeable: true, mergeableState: 'mergeable', checks: 'green' as const,
    } as never);

    const result = await Effect.runPromise(dispatchTestAgentAndNotify('PAN-503', '/tmp/workspace'));

    expect(spawnRun).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: false, notified: false, reason: 'no-open-pr' });
  });
});
