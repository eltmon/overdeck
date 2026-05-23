import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResolveProjectFromIssue, mockSpawnReviewSubRoleForIssue } = vi.hoisted(() => ({
  mockResolveProjectFromIssue: vi.fn(),
  mockSpawnReviewSubRoleForIssue: vi.fn(),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: mockResolveProjectFromIssue,
  resolveProjectFromIssueSync: mockResolveProjectFromIssue,
}));

vi.mock('../../../src/lib/cloister/review-agent.js', () => ({
  spawnReviewSubRoleForIssue: mockSpawnReviewSubRoleForIssue,
}));

describe('reviewSpawnReviewerCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockResolveProjectFromIssue.mockReturnValue({
      projectPath: '/repo',
      projectKey: 'panopticon',
    });
    mockSpawnReviewSubRoleForIssue.mockReturnValue(Effect.succeed({
      success: true,
      message: 'Review security spawned: agent-pan-1059-review-security',
      sessionId: 'agent-pan-1059-review-security',
    }));
  });

  it('forwards explicit orchestration paths to the sub-role spawner', async () => {
    const { reviewSpawnReviewerCommand } = await import('../../../src/cli/commands/review-spawn-reviewer.js');

    await reviewSpawnReviewerCommand('pan-1059', {
      subRole: 'security',
      runId: 'agent-pan-1059-review-abcdef12',
      workspace: '/workspace',
      output: '/workspace/.pan/review/agent-pan-1059-review-abcdef12/security.md',
      context: '/workspace/.pan/review/agent-pan-1059-review-abcdef12/context.json',
      model: 'claude-sonnet-4-6',
    });

    expect(mockSpawnReviewSubRoleForIssue).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      workspace: '/workspace',
      subRole: 'security',
      runId: 'agent-pan-1059-review-abcdef12',
      outputPath: '/workspace/.pan/review/agent-pan-1059-review-abcdef12/security.md',
      contextManifestPath: '/workspace/.pan/review/agent-pan-1059-review-abcdef12/context.json',
      model: 'claude-sonnet-4-6',
    });
  });

  it('derives workspace, output, and context paths from the issue project', async () => {
    const { reviewSpawnReviewerCommand } = await import('../../../src/cli/commands/review-spawn-reviewer.js');

    await reviewSpawnReviewerCommand('PAN-1059', {
      subRole: 'requirements',
      runId: 'agent-pan-1059-review-abcdef12',
    });

    expect(mockSpawnReviewSubRoleForIssue).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      workspace: '/repo/workspaces/feature-pan-1059',
      subRole: 'requirements',
      runId: 'agent-pan-1059-review-abcdef12',
      outputPath: '/repo/workspaces/feature-pan-1059/.pan/review/agent-pan-1059-review-abcdef12/requirements.md',
      contextManifestPath: '/repo/workspaces/feature-pan-1059/.pan/review/agent-pan-1059-review-abcdef12/context.json',
      model: undefined,
    });
  });
});
