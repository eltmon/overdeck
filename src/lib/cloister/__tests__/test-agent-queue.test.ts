import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../agents.js', () => ({
  spawnRun: vi.fn(async () => ({ id: 'agent-pan-503-test' })),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/tmp/panopticon' })),
}));

vi.mock('../../review-status.js', () => ({
  setReviewStatus: vi.fn(),
}));

import { spawnRun } from '../../agents.js';
import { resolveProjectFromIssue } from '../../projects.js';
import { setReviewStatus } from '../../review-status.js';
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
    expect(prompt).toContain('verify you are in the workspace above with `pwd`');
    expect(prompt).toContain('Never run build, test, git, or dashboard commands from the main checkout');
    expect(prompt).toContain('build and run the dashboard from the workspace above, not from main');
    expect(prompt).toContain('use the Playwright MCP tools available to the test role');
    expect(prompt).toContain('Do not spawn or wake a separate UAT agent');
    expect(prompt).toContain('/api/review/PAN-503/status');
    expect(prompt).toContain('"testStatus":"passed"');
    expect(prompt).not.toContain('readyForMerge');
    expect(prompt).toContain('Do NOT spawn, wake, or delegate to test-agent or uat-agent specialists');
  });

  it('starts spawnRun(issueId, test) and marks testing', async () => {
    const notifyAgent = vi.fn(async () => {});

    await dispatchTestAgentAndNotify('PAN-503', '/tmp/workspace', 'feature/pan-503', notifyAgent);

    expect(spawnRun).toHaveBeenCalledWith('PAN-503', 'test', expect.objectContaining({
      workspace: '/tmp/workspace',
      prompt: expect.stringContaining('TEST TASK for PAN-503'),
    }));
    expect(setReviewStatus).toHaveBeenCalledWith('PAN-503', { testStatus: 'testing' });
    expect(notifyAgent).toHaveBeenCalledWith(
      'agent-pan-503',
      expect.stringContaining('The test role has been dispatched automatically'),
    );
  });

  it('does not spawn when no project is configured', async () => {
    vi.mocked(resolveProjectFromIssue).mockReturnValueOnce(null);

    await dispatchTestAgentAndNotify('PAN-503', '/tmp/workspace', 'feature/pan-503');

    expect(spawnRun).not.toHaveBeenCalled();
    expect(setReviewStatus).toHaveBeenCalledWith('PAN-503', {
      testStatus: 'dispatch_failed',
      testNotes: 'No project configured for PAN-503. Add it to projects.yaml.',
    });
  });
});
