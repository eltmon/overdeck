import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTracker, TrackerConfig } from '../../../src/lib/tracker/factory.js';
import { LinearTracker } from '../../../src/lib/tracker/linear.js';
import { GitHubTracker } from '../../../src/lib/tracker/github.js';
import { GitLabTracker } from '../../../src/lib/tracker/gitlab.js';
import { TrackerAuthError } from '../../../src/lib/tracker/interface.js';
import { JiraTracker } from '../../../src/lib/tracker/jira.js';
import { loadConfigSync } from '../../../src/lib/config-yaml.js';
import { findProjectByTeam } from '../../../src/lib/projects.js';

// Mock config-yaml to prevent filesystem reads
vi.mock('../../../src/lib/config-yaml.js', () => ({
  loadConfigSync: vi.fn(() => ({ trackerKeys: {} })),
}));

vi.mock('../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/projects.js')>()),
  findProjectByTeam: vi.fn(() => null),
}));

describe('createTracker', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.LINEAR_API_KEY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITLAB_TOKEN;
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_BASE_URL;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe('Linear tracker', () => {
    it('should create LinearTracker with valid config', () => {
      process.env.LINEAR_API_KEY = 'test-key';

      const config: TrackerConfig = {
        type: 'linear',
        team: 'MIN',
      };

      const tracker = createTracker(config);
      expect(tracker).toBeInstanceOf(LinearTracker);
      expect(tracker.name).toBe('linear');
    });

    it('should throw TrackerAuthError when API key missing', () => {
      const config: TrackerConfig = {
        type: 'linear',
      };

      expect(() => createTracker(config)).toThrow(TrackerAuthError);
    });

    it('should use custom env var for API key', () => {
      process.env.MY_LINEAR_KEY = 'custom-key';

      const config: TrackerConfig = {
        type: 'linear',
        apiKeyEnv: 'MY_LINEAR_KEY',
      };

      const tracker = createTracker(config);
      expect(tracker).toBeInstanceOf(LinearTracker);

      delete process.env.MY_LINEAR_KEY;
    });
  });

  describe('GitHub tracker', () => {
    it('should create GitHubTracker with valid config', () => {
      process.env.GITHUB_TOKEN = 'test-token';

      const config: TrackerConfig = {
        type: 'github',
        owner: 'eltmon',
        repo: 'overdeck',
      };

      const tracker = createTracker(config);
      expect(tracker).toBeInstanceOf(GitHubTracker);
      expect(tracker.name).toBe('github');
    });

    it('should throw TrackerAuthError when token missing', () => {
      const config: TrackerConfig = {
        type: 'github',
        owner: 'eltmon',
        repo: 'test',
      };

      expect(() => createTracker(config)).toThrow(TrackerAuthError);
    });

    it('should throw Error when owner/repo missing', () => {
      process.env.GITHUB_TOKEN = 'test-token';

      const config: TrackerConfig = {
        type: 'github',
      };

      expect(() => createTracker(config)).toThrow('GitHub tracker requires owner and repo');
    });
  });

  describe('GitLab tracker', () => {
    it('should create GitLabTracker with valid config', () => {
      process.env.GITLAB_TOKEN = 'test-token';

      const config: TrackerConfig = {
        type: 'gitlab',
        projectId: '12345',
      };

      const tracker = createTracker(config);
      expect(tracker).toBeInstanceOf(GitLabTracker);
      expect(tracker.name).toBe('gitlab');
    });

    it('should throw Error when projectId missing', () => {
      process.env.GITLAB_TOKEN = 'test-token';

      const config: TrackerConfig = {
        type: 'gitlab',
      };

      expect(() => createTracker(config)).toThrow('GitLab tracker requires projectId');
    });
  });

  describe('Jira tracker (PAN-5152)', () => {
    // Built at runtime so push protection never sees a token-shaped literal (NFR-3).
    const fakeToken = ['fake', 'jira', 'token'].join('-');
    const withTrackerKeys = (trackerKeys: Record<string, string>) =>
      vi.mocked(loadConfigSync).mockReturnValue({ config: { trackerKeys } } as unknown as ReturnType<typeof loadConfigSync>);

    afterEach(() => {
      vi.mocked(loadConfigSync).mockReset();
      vi.mocked(findProjectByTeam).mockReset();
      vi.mocked(findProjectByTeam).mockReturnValue(null);
      vi.unstubAllGlobals();
    });

    it('throws TrackerAuthError naming JIRA_API_TOKEN when no token is configured', () => {
      withTrackerKeys({});
      expect(() => createTracker({ type: 'jira' })).toThrow(TrackerAuthError);
      expect(() => createTracker({ type: 'jira' })).toThrow(/JIRA_API_TOKEN/);
    });

    it('throws when the project key is missing', () => {
      withTrackerKeys({ jira: fakeToken, jiraEmail: 'dev@example.com', jiraBaseUrl: 'https://acme.atlassian.net' });
      expect(() => createTracker({ type: 'jira' })).toThrow('Jira tracker requires the project key (issue_prefix)');
    });

    it('creates a JiraTracker from Settings credentials', () => {
      withTrackerKeys({ jira: fakeToken, jiraEmail: 'dev@example.com', jiraBaseUrl: 'https://acme.atlassian.net' });
      const tracker = createTracker({ type: 'jira', project: 'PROJ' });
      expect(tracker).toBeInstanceOf(JiraTracker);
      expect(tracker.name).toBe('jira');
      expect((tracker as JiraTracker).site).toBe('https://acme.atlassian.net');
    });

    it('targets the registered project site when only the prefix is passed as team (D-22)', async () => {
      withTrackerKeys({ jira: fakeToken, jiraBaseUrl: 'https://global.example' });
      vi.mocked(findProjectByTeam).mockReturnValue({
        name: 'Proj',
        path: '/home/user/proj',
        tracker: 'jira',
        issue_prefix: 'PROJ',
        jira: { site: 'https://p.example', deployment: 'datacenter' },
      });
      const requested: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
        requested.push(String(input));
        return new Response(JSON.stringify({ id: '1', key: 'PROJ-1', fields: { summary: 'x' } }), { status: 200 });
      }));

      const tracker = createTracker({ type: 'jira', team: 'PROJ' });
      expect(findProjectByTeam).toHaveBeenCalledWith('PROJ');
      await Effect.runPromise(tracker.getIssue('PROJ-1'));
      expect(requested.length).toBeGreaterThan(0);
      expect(requested.every(url => url.startsWith('https://p.example/'))).toBe(true);
    });
  });

  describe('Unknown tracker', () => {
    it('should throw Error for unknown tracker type', () => {
      const config = {
        type: 'trello' as any,
      };

      expect(() => createTracker(config)).toThrow('Unknown tracker type: trello');
    });
  });
});
