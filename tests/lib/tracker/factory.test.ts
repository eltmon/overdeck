import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTracker, TrackerConfig } from '../../../src/lib/tracker/factory.js';
import { LinearTracker } from '../../../src/lib/tracker/linear.js';
import { GitHubTracker } from '../../../src/lib/tracker/github.js';
import { GitLabTracker } from '../../../src/lib/tracker/gitlab.js';
import { TrackerAuthError } from '../../../src/lib/tracker/interface.js';

// Mock config-yaml to prevent filesystem reads
vi.mock('../../../src/lib/config-yaml.js', () => ({
  loadConfig: vi.fn(() => ({ trackerKeys: {} })),
  loadConfigSync: vi.fn(() => ({ trackerKeys: {} })),
}));

describe('createTracker', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.LINEAR_API_KEY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITLAB_TOKEN;
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
        repo: 'panopticon-cli',
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

  describe('Unknown tracker', () => {
    it('should throw Error for unknown tracker type', () => {
      const config = {
        type: 'jira' as any,
      };

      expect(() => createTracker(config)).toThrow('Unknown tracker type: jira');
    });
  });
});
