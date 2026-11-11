import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findJiraProjectsAsync: vi.fn(),
  createJiraTrackerForProject: vi.fn(),
  exitCli: vi.fn(),
}));

vi.mock('../../../src/lib/tracker/tracker-projects.js', () => ({ findJiraProjectsAsync: mocks.findJiraProjectsAsync }));
vi.mock('../../../src/lib/tracker/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/tracker/index.js')>()),
  createJiraTrackerForProject: mocks.createJiraTrackerForProject,
}));
vi.mock('../../../src/lib/config.js', () => ({ loadConfigSync: () => ({ trackers: { primary: 'linear' } }) }));
vi.mock('../../../src/cli/exit.js', () => ({ exitCli: mocks.exitCli }));
vi.mock('ora', () => ({
  default: () => {
    const spinner = { text: '', start: () => spinner, stop: () => spinner, fail: vi.fn(() => spinner), succeed: () => spinner };
    return spinner;
  },
}));

import { listCommand } from '../../../src/cli/commands/issues.js';

const issue = (ref: string, state: 'open' | 'in_progress' | 'in_review') => ({
  id: ref, ref, title: `Title ${ref}`, description: '', state, labels: [], url: `https://acme.atlassian.net/browse/${ref}`,
  tracker: 'jira' as const, createdAt: '', updatedAt: '',
});

let output: string[];

beforeEach(() => {
  vi.clearAllMocks();
  output = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { output.push(args.map(String).join(' ')); });
});

describe('pan issues --tracker jira (PAN-5152)', () => {
  it('lists every Jira project under one JIRA header', async () => {
    mocks.findJiraProjectsAsync.mockResolvedValue([
      { key: 'acme', config: { name: 'Acme', path: '/a', tracker: 'jira', issue_prefix: 'ACME' } },
      { key: 'proj', config: { name: 'Proj', path: '/p', tracker: 'jira', issue_prefix: 'PROJ' } },
    ]);
    mocks.createJiraTrackerForProject.mockImplementation((key: string) => ({
      listIssues: () => Effect.succeed(key === 'acme' ? [issue('ACME-1', 'open')] : [issue('PROJ-2', 'in_review')]),
    }));

    await listCommand({ tracker: 'jira' });

    const text = output.join('\n');
    expect(text).toContain('JIRA (2 issues)');
    expect(text).toContain('ACME-1');
    expect(text).toContain('PROJ-2');
    expect(text).toContain('In Review (1)');
    expect(mocks.exitCli).not.toHaveBeenCalled();
  });

  it('names jira among the valid trackers for an unknown --tracker', async () => {
    await listCommand({ tracker: 'trello' });

    expect(output.join('\n')).toContain('Valid trackers: linear, github, gitlab, rally, jira');
    expect(mocks.exitCli).toHaveBeenCalledWith(1);
  });
});
