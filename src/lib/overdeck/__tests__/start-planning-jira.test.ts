import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackerError } from '../../errors.js';
import { JiraTracker } from '../../tracker/jira.js';

const mocks = vi.hoisted(() => ({
  spawnPlanningSession: vi.fn(),
  createJiraTrackerForProject: vi.fn(),
  transitionJiraIssue: vi.fn(async () => ({ kind: 'transitioned', message: 'ok' })),
}));

vi.mock('../../tracker-utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tracker-utils.js')>()),
  resolveTrackerType: vi.fn(() => 'jira'),
  resolveGitHubIssue: vi.fn(() => ({ isGitHub: false })),
}));

vi.mock('../../projects.js', async (importOriginal) => {
  const { Effect: E } = await import('effect');
  return {
    ...(await importOriginal<typeof import('../../projects.js')>()),
    resolveProjectFromIssue: vi.fn(() => E.succeed({ projectKey: 'acme', projectName: 'Acme', projectPath: '/tmp/acme' })),
    resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'acme', projectName: 'Acme', projectPath: '/tmp/acme' })),
    loadProjectsConfig: vi.fn(() => E.succeed({
      projects: { acme: { name: 'Acme', path: '/tmp/acme', tracker: 'jira', issue_prefix: 'PROJ' } },
    })),
  };
});

vi.mock('../../tracker/factory.js', () => ({ createJiraTrackerForProject: mocks.createJiraTrackerForProject }));
vi.mock('../../tracker/jira-lifecycle.js', () => ({ transitionJiraIssue: mocks.transitionJiraIssue }));
vi.mock('../../planning/spawn-planning-session.js', () => ({ spawnPlanningSession: mocks.spawnPlanningSession }));
vi.mock('../../tmux.js', async (importOriginal) => {
  const { Effect: E } = await import('effect');
  return { ...(await importOriginal<typeof import('../../tmux.js')>()), listSessionNames: vi.fn(() => E.succeed([])) };
});
vi.mock('../../agents.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents.js')>()),
  saveAgentStateSync: vi.fn(),
  getProviderAuthMode: vi.fn(async () => undefined),
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  mkdir: vi.fn(async () => undefined),
}));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: vi.fn(), emitActivityTts: vi.fn() }));
vi.mock('../../terminal-backends/launch.js', () => ({ closeAgentPane: vi.fn(async () => undefined) }));
vi.mock('../workspace-hygiene.js', () => ({ cleanupAgentStateDirs: vi.fn(async () => undefined) }));
vi.mock('../../../dashboard/server/routes/agents.js', () => ({ invalidateAgentsCache: vi.fn() }));
vi.mock('../../../dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ patchIssue: vi.fn() }),
}));

import { abortPlanningForIssue, startPlanningForIssue } from '../planning-sessions.js';

// Built at runtime so push protection never sees a token-shaped literal (NFR-3).
const fakeToken = ['fake', 'jira', 'token'].join('-');

const adf = (...content: unknown[]) => ({ type: 'doc', version: 1, content });

function stubJira(issueStatus = 200): JiraTracker {
  const fetchImpl: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/comment')) {
      return new Response(JSON.stringify({ comments: [{
        id: 'c1', author: { displayName: 'Ada' }, created: '2026-11-03',
        body: adf({ type: 'paragraph', content: [{ type: 'text', text: 'Ship it', marks: [{ type: 'strong' }] }] }),
      }] }));
    }
    if (issueStatus !== 200) return new Response('', { status: issueStatus });
    return new Response(JSON.stringify({
      id: '10001',
      key: 'PROJ-1',
      fields: {
        summary: 'Add Jira support',
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        issuetype: { name: 'Story' },
        description: adf(
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Goal' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Teams on Jira can use Overdeck.' }] },
        ),
      },
    }));
  };
  return new JiraTracker({
    credentials: { token: fakeToken, email: 'dev@example.com', site: 'https://acme.atlassian.net' },
    projectKey: 'PROJ',
    project: { deployment: 'cloud' },
    fetchImpl,
  });
}

function deps() {
  return {
    eventStore: { append: vi.fn(() => Effect.void) },
    linear: { getIssue: vi.fn(() => Effect.fail(new Error('Linear must not be called'))) },
    github: { getIssue: vi.fn(), getComments: vi.fn() },
    rally: { getIssue: vi.fn(), getChildIssues: vi.fn() },
    lifecycle: { transitionTo: vi.fn(() => Effect.void), addLabel: vi.fn(() => Effect.void), removeLabel: vi.fn(() => Effect.void) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spawnPlanningSession.mockResolvedValue({ success: true });
});

describe('startPlanningForIssue for a Jira issue (PAN-5152)', () => {
  it('hands the planner the Jira summary, Markdown description and Markdown comments', async () => {
    mocks.createJiraTrackerForProject.mockReturnValue(stubJira());
    const d = deps();

    await Effect.runPromise(startPlanningForIssue({ id: 'PROJ-1', body: {}, startedBy: 'test', ...d }));
    await vi.waitFor(() => expect(mocks.spawnPlanningSession).toHaveBeenCalled());

    const { issue } = mocks.spawnPlanningSession.mock.calls[0][0];
    expect(issue).toMatchObject({ identifier: 'PROJ-1', title: 'Add Jira support', source: 'jira', url: 'https://acme.atlassian.net/browse/PROJ-1' });
    expect(issue.description.startsWith('# ')).toBe(true);
    expect(issue.description).toBe('# Goal\nTeams on Jira can use Overdeck.');
    expect(issue.comments).toEqual([{ author: 'Ada', body: '**Ship it**', createdAt: '2026-11-03' }]);
    expect(d.linear.getIssue).not.toHaveBeenCalled();
  });

  it('fails with the could-not-fetch error and never calls Linear when Jira getIssue fails', async () => {
    mocks.createJiraTrackerForProject.mockReturnValue(stubJira(500));
    const d = deps();

    const error = await Effect.runPromise(Effect.flip(startPlanningForIssue({ id: 'PROJ-1', body: {}, startedBy: 'test', ...d })));
    expect(error).toMatchObject({ _tag: 'TrackerApiError', tracker: 'jira' });
    expect((error as { message: string }).message).toMatch(/^could not fetch PROJ-1 from Jira: /);
    expect((error as { cause?: unknown }).cause).toBeInstanceOf(TrackerError);
    expect(d.linear.getIssue).not.toHaveBeenCalled();
    expect(mocks.spawnPlanningSession).not.toHaveBeenCalled();
  });
});

describe('abortPlanningForIssue for a Jira issue (PAN-5152)', () => {
  it('moves the issue back to To Do through the seam, not the Linear client', async () => {
    const d = deps();
    await Effect.runPromise(abortPlanningForIssue({ id: 'PROJ-1', body: {}, lifecycle: d.lifecycle, linear: d.linear, eventStore: d.eventStore }));

    expect(mocks.transitionJiraIssue).toHaveBeenCalledWith('PROJ-1', 'todo');
    expect(d.linear.getIssue).not.toHaveBeenCalled();
  });
});
