import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JiraTracker } from '../../../../lib/tracker/jira.js';

const { mockFindJiraProjectsAsync, mockCreateJiraTrackerForProject } = vi.hoisted(() => ({
  mockFindJiraProjectsAsync: vi.fn(),
  mockCreateJiraTrackerForProject: vi.fn(),
}));

vi.mock('../../../../lib/tracker/tracker-projects.js', () => ({
  findJiraProjectsAsync: mockFindJiraProjectsAsync,
}));

vi.mock('../../../../lib/tracker/factory.js', () => ({
  createJiraTrackerForProject: mockCreateJiraTrackerForProject,
}));

import { fetchJiraDashboardIssues } from '../jira-issue-poller.js';

// Built at runtime so push protection never sees a token-shaped literal (NFR-3).
const fakeToken = ['fake', 'jira', 'token'].join('-');

const rawIssue = (key: string, status: string) => ({
  id: `id-${key}`,
  key,
  fields: {
    summary: `Summary of ${key}`,
    description: 'Body',
    status: { name: status, statusCategory: { key: 'indeterminate' } },
    labels: ['backend'],
    priority: { name: 'High' },
    created: '2026-11-01T10:00:00.000+0000',
    updated: '2026-11-02T10:00:00.000+0000',
  },
});

function stubTracker(issues: unknown[], status = 200): JiraTracker {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ issues, total: issues.length }), { status });
  return new JiraTracker({
    credentials: { token: fakeToken, site: 'https://jira.example.com' },
    projectKey: 'PROJ',
    project: { deployment: 'datacenter', status_map: { in_review: 'Code Review' } },
    fetchImpl,
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('fetchJiraDashboardIssues', () => {
  it('maps Jira issues to dashboard rows with their canonical status', async () => {
    mockFindJiraProjectsAsync.mockResolvedValue([{ key: 'proj', config: { name: 'Proj', path: '/p', tracker: 'jira', issue_prefix: 'PROJ' } }]);
    mockCreateJiraTrackerForProject.mockReturnValue(stubTracker([rawIssue('PROJ-1', 'In Progress'), rawIssue('PROJ-2', 'Code Review')]));

    const rows = await fetchJiraDashboardIssues();
    expect(rows.map(row => [row.identifier, row.canonicalStatus, row.status, row.source])).toEqual([
      ['PROJ-1', 'in_progress', 'In Progress', 'jira'],
      ['PROJ-2', 'in_review', 'In Review', 'jira'],
    ]);
    expect(rows[0]).toMatchObject({
      id: 'jira-id-PROJ-1',
      state: 'in_progress',
      rawTrackerState: 'In Progress',
      priority: 2,
      labels: ['backend'],
      url: 'https://jira.example.com/browse/PROJ-1',
      project: { id: 'jira-proj', name: 'Proj', color: '#2684FF', icon: 'jira' },
    });
  });

  it('keeps the other projects when one project fails', async () => {
    mockFindJiraProjectsAsync.mockResolvedValue([
      { key: 'broken', config: { name: 'Broken', path: '/b', tracker: 'jira', issue_prefix: 'BRK' } },
      { key: 'proj', config: { name: 'Proj', path: '/p', tracker: 'jira', issue_prefix: 'PROJ' } },
    ]);
    mockCreateJiraTrackerForProject.mockImplementation((key: string) =>
      key === 'broken' ? stubTracker([], 500) : stubTracker([rawIssue('PROJ-1', 'In Progress')]));

    const rows = await fetchJiraDashboardIssues();
    expect(rows.map(row => row.identifier)).toEqual(['PROJ-1']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[jira-poll\] broken: /));
  });

  it('logs and skips a project whose tracker cannot be built', async () => {
    mockFindJiraProjectsAsync.mockResolvedValue([{ key: 'nokey', config: { name: 'No key', path: '/n', tracker: 'jira' } }]);
    mockCreateJiraTrackerForProject.mockImplementation(() => { throw new Error('Project nokey has no issue_prefix'); });

    await expect(fetchJiraDashboardIssues()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith('[jira-poll] nokey: Project nokey has no issue_prefix');
  });
});
