import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agents.js', () => ({
  spawnRun: vi.fn(async () => ({ id: 'agent-pan-503-test' })),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/tmp/panopticon' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/tmp/panopticon' })),
}));

vi.mock('../../review-status.js', () => ({
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
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
      apiUrl: 'http://localhost:3011',
    });

    expect(prompt).toContain('TEST TASK for PAN-503');
    expect(prompt).toContain('use the Playwright MCP tools available to the test role');
    expect(prompt).toContain('Do not spawn or wake a separate UAT agent');
    expect(prompt).toContain('/api/review/PAN-503/status');
    expect(prompt).toContain('"testStatus":"passed"');
    expect(prompt).not.toContain('readyForMerge');
    expect(prompt).toContain('Do NOT spawn, wake, or delegate to test-agent or uat-agent specialists');
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
