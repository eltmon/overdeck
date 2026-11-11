/**
 * IssueLifecycle routes Jira issues through the non-failing write seam (PAN-5152).
 */

import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTrackerType: vi.fn(() => 'jira'),
  resolveGitHubIssue: vi.fn(() => ({ isGitHub: false })),
  transitionJiraIssue: vi.fn(async () => ({ kind: 'transitioned', message: 'ok' })),
  patchIssue: vi.fn(),
  linear: {
    getIssue: vi.fn(),
    getTeamStates: vi.fn(),
    updateState: vi.fn(),
    addComment: vi.fn(),
    getComments: vi.fn(),
    findOrCreateLabel: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
  },
  rallyUpdateState: vi.fn(),
}));

vi.mock('../../../../lib/tracker-utils.js', () => ({
  resolveTrackerType: mocks.resolveTrackerType,
  resolveGitHubIssue: mocks.resolveGitHubIssue,
}));

vi.mock('../../../../lib/tracker/jira-lifecycle.js', () => ({
  transitionJiraIssue: mocks.transitionJiraIssue,
}));

vi.mock('../issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ patchIssue: mocks.patchIssue }),
}));

async function lifecycle() {
  const { LinearClient } = await import('../linear-client.js');
  const { GitHubClient } = await import('../github-client.js');
  const { RallyClient } = await import('../rally-client.js');
  const { IssueLifecycle, IssueLifecycleLive } = await import('../issue-lifecycle.js');

  const layer = IssueLifecycleLive.pipe(
    Layer.provide(Layer.succeed(LinearClient, mocks.linear as never)),
    Layer.provide(Layer.succeed(GitHubClient, {
      getIssue: vi.fn(), addLabel: vi.fn(), removeLabel: vi.fn(), closeIssue: vi.fn(),
      reopenIssue: vi.fn(), ensureLabel: vi.fn(), addComment: vi.fn(), getComments: vi.fn(),
    } as never)),
    Layer.provide(Layer.succeed(RallyClient, {
      getIssue: vi.fn(), getChildIssues: vi.fn(), updateState: mocks.rallyUpdateState, addComment: vi.fn(),
    } as never)),
  );
  return <A, E>(program: (service: typeof IssueLifecycle.Service) => Effect.Effect<A, E>) =>
    Effect.runPromise(Effect.gen(function* () {
      const service = yield* IssueLifecycle;
      return yield* program(service);
    }).pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveTrackerType.mockReturnValue('jira');
  mocks.transitionJiraIssue.mockResolvedValue({ kind: 'transitioned', message: 'ok' });
});

describe('IssueLifecycle for Jira issues', () => {
  it('sends the merge handoff state to the Jira seam and never calls Linear', async () => {
    const run = await lifecycle();
    await run(service => service.transitionTo('PROJ-1', 'verifying_on_main'));

    expect(mocks.transitionJiraIssue).toHaveBeenCalledWith('PROJ-1', 'verifying_on_main');
    for (const method of Object.values(mocks.linear)) expect(method).not.toHaveBeenCalled();
    expect(mocks.rallyUpdateState).not.toHaveBeenCalled();
  });

  it('passes in_planning through and maps open to todo', async () => {
    const run = await lifecycle();
    await run(service => service.transitionTo('PROJ-1', 'in_planning'));
    await run(service => service.transitionTo('PROJ-1', 'open'));

    expect(mocks.transitionJiraIssue).toHaveBeenNthCalledWith(1, 'PROJ-1', 'in_planning');
    expect(mocks.transitionJiraIssue).toHaveBeenNthCalledWith(2, 'PROJ-1', 'todo');
  });

  it('closes a Jira issue with target done', async () => {
    const run = await lifecycle();
    await run(service => service.close('PROJ-1'));

    expect(mocks.transitionJiraIssue).toHaveBeenCalledWith('PROJ-1', 'done');
    expect(mocks.patchIssue).toHaveBeenCalledWith('PROJ-1', { canonicalStatus: 'closed' });
  });

  it('succeeds when the seam reports an error', async () => {
    mocks.transitionJiraIssue.mockResolvedValue({ kind: 'error', message: 'Jira rejected the credentials (HTTP 401).' });
    const run = await lifecycle();

    await expect(run(service => service.transitionTo('PROJ-1', 'in_review'))).resolves.toBeUndefined();
    await expect(run(service => service.close('PROJ-1'))).resolves.toBeUndefined();
  });
});
