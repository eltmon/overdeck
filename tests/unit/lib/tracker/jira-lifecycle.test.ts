import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackerError } from '../../../../src/lib/errors.js';

const { mockResolveProjectFromIssue, mockLoadProjectsConfig, mockCreateJiraTrackerForProject } = vi.hoisted(() => ({
  mockResolveProjectFromIssue: vi.fn(),
  mockLoadProjectsConfig: vi.fn(),
  mockCreateJiraTrackerForProject: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: mockResolveProjectFromIssue,
  loadProjectsConfig: mockLoadProjectsConfig,
}));

vi.mock('../../../../src/lib/tracker/factory.js', () => ({
  createJiraTrackerForProject: mockCreateJiraTrackerForProject,
}));

import {
  commentOnJiraIssue,
  linkJiraPullRequest,
  transitionJiraIssue,
} from '../../../../src/lib/tracker/jira-lifecycle.js';

function registerProject(tracker: string | undefined) {
  mockResolveProjectFromIssue.mockReturnValue(Effect.succeed({ projectKey: 'proj', projectName: 'Proj', projectPath: '/p' }));
  mockLoadProjectsConfig.mockReturnValue(Effect.succeed({
    projects: { proj: { name: 'Proj', path: '/p', issue_prefix: 'PROJ', ...(tracker ? { tracker } : {}) } },
  }));
}

let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  log.mockRestore();
});

describe('jira write seam', () => {
  it('resolves an error outcome instead of rejecting when the adapter fails', async () => {
    registerProject('jira');
    const failure = new TrackerError({ tracker: 'jira', operation: 'POST /rest/api/3/issue/PROJ-1/comment', message: 'Jira POST failed: 500' });
    mockCreateJiraTrackerForProject.mockReturnValue({
      addComment: () => Effect.fail(failure),
      linkPR: () => Effect.fail(failure),
      transitionToCanonical: () => Effect.fail(failure),
    });

    await expect(commentOnJiraIssue('PROJ-1', 'hi')).resolves.toEqual({ kind: 'error', message: 'Jira POST failed: 500' });
    await expect(linkJiraPullRequest('PROJ-1', 'https://github.com/o/r/pull/1')).resolves.toMatchObject({ kind: 'error' });
    await expect(transitionJiraIssue('PROJ-1', 'done')).resolves.toMatchObject({ kind: 'error' });
    expect(warn).toHaveBeenCalledWith('[jira] PROJ-1: comment failed: Jira POST failed: 500');
  });

  it('logs the wanted status and the available transitions on no-transition', async () => {
    registerProject('jira');
    const message = 'Jira PROJ-1: no transition reaches "Canceled" (available: Start → In Progress, Finish → Done); status left unchanged.';
    mockCreateJiraTrackerForProject.mockReturnValue({
      transitionToCanonical: () => Effect.succeed({ kind: 'no-transition', message }),
    });

    await expect(transitionJiraIssue('PROJ-1', 'canceled')).resolves.toEqual({ kind: 'no-transition', message });
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('"Canceled"');
    expect(line).toContain('Start → In Progress');
    expect(line).toContain('Finish → Done');
  });

  it('logs one ok line on success', async () => {
    registerProject('jira');
    mockCreateJiraTrackerForProject.mockReturnValue({ linkPR: () => Effect.void });

    await expect(linkJiraPullRequest('PROJ-1', 'https://github.com/o/r/pull/1')).resolves.toMatchObject({ kind: 'ok' });
    expect(log).toHaveBeenCalledWith('[jira] PROJ-1: link pull request ok');
  });

  it('returns not a Jira issue without building an adapter for other trackers', async () => {
    registerProject('linear');

    await expect(commentOnJiraIssue('PROJ-1', 'hi')).resolves.toEqual({ kind: 'error', message: 'not a Jira issue' });
    await expect(transitionJiraIssue('PROJ-1', 'done')).resolves.toEqual({ kind: 'error', message: 'not a Jira issue' });
    expect(mockCreateJiraTrackerForProject).not.toHaveBeenCalled();
  });

  it('returns not a Jira issue for an unregistered prefix', async () => {
    mockResolveProjectFromIssue.mockReturnValue(Effect.succeed(null));

    await expect(linkJiraPullRequest('NOPE-1', 'https://github.com/o/r/pull/1')).resolves.toEqual({ kind: 'error', message: 'not a Jira issue' });
    expect(mockCreateJiraTrackerForProject).not.toHaveBeenCalled();
  });
});
