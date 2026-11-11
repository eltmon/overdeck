/**
 * Tests for getTrackerContext() in work-agent-prompt.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import * as fs from 'fs';

// Mock fs before importing the module under test
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

// Mock config and tracker modules
vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: vi.fn(),
  loadConfigSync: vi.fn(),
}));

vi.mock('../../../src/lib/tracker/factory.js', () => ({
  createTrackerFromConfig: vi.fn(),
  createJiraTrackerForProject: vi.fn(),
}));

// Non-Jira routing by default (fs is mocked, so the real resolver cannot read
// its env file here); the Jira cases override it (PAN-5152).
vi.mock('../../../src/lib/tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/tracker-utils.js')>();
  return { ...actual, resolveTrackerType: vi.fn(() => 'github') };
});

vi.mock('../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/projects.js')>();
  return { ...actual, findProjectByTeam: vi.fn(actual.findProjectByTeam) };
});

import { getTrackerContext } from '../../../src/lib/cloister/work-agent-prompt.js';
import { loadConfigSync } from '../../../src/lib/config.js';
import { createJiraTrackerForProject, createTrackerFromConfig } from '../../../src/lib/tracker/factory.js';
import { NotImplementedError } from '../../../src/lib/tracker/interface.js';
import { JiraTracker } from '../../../src/lib/tracker/jira.js';
import { resolveTrackerType } from '../../../src/lib/tracker-utils.js';
import { findProjectByTeam } from '../../../src/lib/projects.js';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockStatSync = vi.mocked(fs.statSync);
const mockLoadConfig = vi.mocked(loadConfigSync);
const mockCreateTrackerFromConfig = vi.mocked(createTrackerFromConfig);

const STATE_MTIME = new Date('2025-01-10T00:00:00Z');
const OLD_COMMENT_DATE = '2025-01-09T12:00:00Z';  // before STATE.md
const NEW_COMMENT_DATE = '2025-01-11T08:00:00Z';  // after STATE.md

function makeTracker(overrides: Partial<{
  getIssue: () => any;
  getComments: () => any;
}> = {}) {
  // Production work-agent-prompt calls tracker via Effect.runPromise(tracker.getIssue/getComments)
  // so mocks must return Effects. mockReturnValue (not mockResolvedValue) yields the value as-is.
  return {
    getIssue: vi.fn().mockReturnValue(Effect.succeed({
      id: 'PAN-253',
      ref: 'PAN-253',
      title: 'Test issue',
      state: 'open',
      rawState: 'Open',
      url: 'https://github.com/org/repo/issues/253',
      tracker: 'github',
      labels: [],
      description: '',
      createdAt: OLD_COMMENT_DATE,
      updatedAt: NEW_COMMENT_DATE,
    })),
    getComments: vi.fn().mockReturnValue(Effect.succeed([])),
    ...overrides,
  };
}

function setupStateMtime(mtime: Date | null = STATE_MTIME) {
  if (mtime === null) {
    mockExistsSync.mockReturnValue(false);
  } else {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ mtime } as any);
  }
}

function setupConfig(primary: string = 'github', secondary?: string) {
  mockLoadConfig.mockReturnValue({
    trackers: { primary, ...(secondary ? { secondary } : {}), github: {}, linear: {} },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTrackerContext', () => {
  describe('when tracker config is unavailable', () => {
    it('returns empty string when no trackers config', async () => {
      setupStateMtime();
      mockLoadConfig.mockReturnValue({ trackers: undefined } as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).toBe('');
    });

    it('returns warning when loadConfig throws', async () => {
      setupStateMtime();
      mockLoadConfig.mockImplementation(() => { throw new Error('no config'); });

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).toContain('Tracker unavailable');
      expect(result).toContain('could not load configuration');
    });
  });

  describe('when STATE.md does not exist', () => {
    it('returns empty string when no new comments and not reopened', async () => {
      setupStateMtime(null);
      setupConfig();
      const tracker = makeTracker();
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).toBe('');
    });
  });

  describe('new comments', () => {
    it('includes comments newer than STATE.md mtime', async () => {
      setupStateMtime();
      setupConfig();
      const tracker = makeTracker({
        getComments: vi.fn().mockReturnValue(Effect.succeed([
          {
            id: '1',
            issueId: 'PAN-253',
            body: 'This is a new comment',
            author: 'alice',
            createdAt: NEW_COMMENT_DATE,
            updatedAt: NEW_COMMENT_DATE,
          },
        ])),
      });
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).toContain('New comments');
      expect(result).toContain('This is a new comment');
      expect(result).toContain('alice');
    });

    it('excludes comments older than STATE.md mtime', async () => {
      setupStateMtime();
      setupConfig();
      const tracker = makeTracker({
        getComments: vi.fn().mockReturnValue(Effect.succeed([
          {
            id: '1',
            issueId: 'PAN-253',
            body: 'Old comment',
            author: 'bob',
            createdAt: OLD_COMMENT_DATE,
            updatedAt: OLD_COMMENT_DATE,
          },
        ])),
      });
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      // No new comments, issue is open (reopened), but no new comment content
      expect(result).not.toContain('Old comment');
    });

    it('truncates long comment bodies', async () => {
      setupStateMtime();
      setupConfig();
      const longBody = 'x'.repeat(1000);
      const tracker = makeTracker({
        getComments: vi.fn().mockReturnValue(Effect.succeed([
          {
            id: '1',
            issueId: 'PAN-253',
            body: longBody,
            author: 'alice',
            createdAt: NEW_COMMENT_DATE,
            updatedAt: NEW_COMMENT_DATE,
          },
        ])),
      });
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).toContain('[truncated — read full comment on tracker]');
      expect(result).not.toContain(longBody);
    });

    it('notes no new comments when STATE.md exists but all comments are old', async () => {
      setupStateMtime();
      setupConfig();
      // Issue is closed so not reopened
      const tracker = makeTracker({
        getIssue: vi.fn().mockReturnValue(Effect.succeed({
          id: 'PAN-253',
          ref: 'PAN-253',
          title: 'Test issue',
          state: 'closed',
          url: 'https://github.com/org/repo/issues/253',
          tracker: 'github',
          labels: [],
          description: '',
          createdAt: OLD_COMMENT_DATE,
          updatedAt: OLD_COMMENT_DATE,
        })),
        getComments: vi.fn().mockReturnValue(Effect.succeed([
          {
            id: '1',
            issueId: 'PAN-253',
            body: 'Old comment',
            author: 'alice',
            createdAt: OLD_COMMENT_DATE,
            updatedAt: OLD_COMMENT_DATE,
          },
        ])),
      });
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      // Closed issue + no new comments = empty (nothing to report)
      expect(result).toBe('');
    });
  });

  describe('reopened detection', () => {
    it('flags issue as reopened when STATE.md exists and issue is open', async () => {
      setupStateMtime();
      setupConfig();
      const tracker = makeTracker(); // state is 'open' by default
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).toContain('ISSUE REOPENED');
    });

    it('flags issue as reopened when state is in_progress', async () => {
      setupStateMtime();
      setupConfig();
      const tracker = makeTracker({
        getIssue: vi.fn().mockReturnValue(Effect.succeed({
          id: 'PAN-253',
          ref: 'PAN-253',
          title: 'Test issue',
          state: 'in_progress',
          rawState: 'In Progress',
          url: 'https://github.com/org/repo/issues/253',
          tracker: 'linear',
          labels: [],
          description: '',
          createdAt: OLD_COMMENT_DATE,
          updatedAt: NEW_COMMENT_DATE,
        })),
      });
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).toContain('ISSUE REOPENED');
    });

    it('does not flag closed issues as reopened', async () => {
      setupStateMtime();
      setupConfig();
      const tracker = makeTracker({
        getIssue: vi.fn().mockReturnValue(Effect.succeed({
          id: 'PAN-253',
          ref: 'PAN-253',
          title: 'Test issue',
          state: 'closed',
          url: 'https://github.com/org/repo/issues/253',
          tracker: 'github',
          labels: [],
          description: '',
          createdAt: OLD_COMMENT_DATE,
          updatedAt: OLD_COMMENT_DATE,
        })),
      });
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).not.toContain('ISSUE REOPENED');
    });
  });

  describe('GitLab NotImplementedError', () => {
    it('treats getComments NotImplementedError as empty comments', async () => {
      setupStateMtime();
      setupConfig('gitlab');
      const tracker = makeTracker({
        getComments: vi.fn().mockReturnValue(Effect.fail(
          new NotImplementedError('GitLab tracker is not yet implemented')
        )),
      });
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      // Should not throw, and should still show tracker status
      const result = await getTrackerContext('PAN-253', '/workspace');
      // Issue is 'open' + STATE.md exists → reopened
      expect(result).toContain('ISSUE REOPENED');
    });
  });

  describe('error handling', () => {
    it('returns warning on auth/network error', async () => {
      setupStateMtime();
      setupConfig();
      const tracker = makeTracker({
        getIssue: vi.fn().mockReturnValue(Effect.fail(new Error('Authentication failed'))),
      });
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).toContain('Tracker unavailable');
      expect(result).toContain('Authentication failed');
    });

    it('returns empty string when issue not found in any tracker', async () => {
      setupStateMtime();
      setupConfig('github');
      const tracker = makeTracker({
        getIssue: vi.fn().mockReturnValue(Effect.fail(new Error('Issue not found: PAN-253'))),
      });
      mockCreateTrackerFromConfig.mockReturnValue(tracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      expect(result).toBe('');
    });

    it('falls through to secondary tracker on not-found', async () => {
      setupStateMtime();
      mockLoadConfig.mockReturnValue({
        trackers: { primary: 'linear', secondary: 'github', linear: {}, github: {} },
      } as any);

      const linearTracker = makeTracker({
        getIssue: vi.fn().mockReturnValue(Effect.fail(new Error('not found in linear'))),
      });
      const githubTracker = makeTracker(); // succeeds

      mockCreateTrackerFromConfig
        .mockReturnValueOnce(linearTracker as any)
        .mockReturnValueOnce(githubTracker as any);

      const result = await getTrackerContext('PAN-253', '/workspace');
      // Should have found issue in github tracker (open issue + STATE.md = reopened)
      expect(result).toContain('ISSUE REOPENED');
    });
  });
});

describe('getTrackerContext for Jira issues (PAN-5152)', () => {
  // Built at runtime so push protection never sees a token-shaped literal (NFR-3).
  const fakeToken = ['fake', 'jira', 'token'].join('-');

  function stubJira(): JiraTracker {
    const fetchImpl: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/comment')) return new Response(JSON.stringify({ comments: [] }));
      return new Response(JSON.stringify({
        id: '10001',
        key: 'PROJ-1',
        fields: {
          summary: 'Add Jira support',
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          description: {
            type: 'doc',
            version: 1,
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Scope' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Read ' }, { type: 'text', text: 'every', marks: [{ type: 'strong' }] }, { type: 'text', text: ' Jira field.' }] },
            ],
          },
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

  it('uses the project Jira tracker without a global [trackers] section and renders the Markdown description', async () => {
    setupStateMtime(null);
    mockLoadConfig.mockReturnValue({ trackers: undefined } as any);
    vi.mocked(resolveTrackerType).mockReturnValueOnce('jira');
    vi.mocked(findProjectByTeam).mockReturnValueOnce({ name: 'Acme', path: '/p', tracker: 'jira', issue_prefix: 'PROJ' });
    vi.mocked(createJiraTrackerForProject).mockReturnValue(stubJira());

    const result = await getTrackerContext('PROJ-1', '/workspace');

    expect(createJiraTrackerForProject).toHaveBeenCalledWith('PROJ', expect.objectContaining({ tracker: 'jira' }));
    expect(mockCreateTrackerFromConfig).not.toHaveBeenCalled();
    expect(result).toContain('**Title:** Add Jira support');
    expect(result).toContain('## Scope\nRead **every** Jira field.');
    expect(result).toContain('**Current state:** In Progress');
  });

  it('still tries the global primary tracker for a non-Jira issue', async () => {
    setupStateMtime();
    setupConfig('github');
    mockCreateTrackerFromConfig.mockReturnValue(makeTracker() as any);

    await getTrackerContext('PAN-253', '/workspace');

    expect(mockCreateTrackerFromConfig).toHaveBeenCalledWith(expect.anything(), 'github');
    expect(createJiraTrackerForProject).not.toHaveBeenCalled();
  });
});

