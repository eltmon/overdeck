/**
 * Tracker Factory
 *
 * Creates appropriate tracker instances based on configuration.
 */

import type { IssueTracker, TrackerType } from './interface.js';
import { TrackerAuthError } from './interface.js';
import { LinearTracker } from './linear.js';
import { GitHubTracker } from './github.js';
import { GitLabTracker } from './gitlab.js';
import { RallyTracker } from './rally.js';
import { JiraTracker } from './jira.js';
import { jiraCredentialFix, type JiraProjectConfig } from './jira-config.js';
import type { TrackersConfig } from '../config.js';
import { loadConfigSync as loadYamlConfig } from '../config-yaml.js';
import { findProjectByTeam, getIssuePrefix, type ProjectConfig } from '../projects.js';
import { extractPrefix } from '../issue-id.js';

// Configuration for a single tracker
export interface TrackerConfig {
  type: TrackerType;

  // Linear-specific
  apiKeyEnv?: string;
  team?: string;

  // GitHub-specific
  tokenEnv?: string;
  owner?: string;
  repo?: string;

  // GitLab-specific
  projectId?: string;

  // Rally-specific (`project` is also the Jira project key)
  server?: string;
  workspace?: string;
  project?: string;

  // Jira-specific (PAN-5152)
  site?: string;
  jiraProject?: JiraProjectConfig;
}

// Multi-tracker configuration (re-exported from config.ts)
// Note: Use TrackersConfig from config.ts for full type with nested configs

/**
 * Get tracker API key from config.yaml (Settings page).
 * This is checked FIRST — env vars are the fallback, not the other way around.
 */
function getTrackerKeyFromConfig(trackerType: TrackerType | 'jiraEmail' | 'jiraBaseUrl'): string | undefined {
  try {
    const { config: yamlConfig } = loadYamlConfig();
    return yamlConfig.trackerKeys[trackerType];
  } catch {
    return undefined;
  }
}

/**
 * Build a JiraTracker (D-22). The project key comes from `config.project`,
 * else `config.team` (generic callers pass the issue prefix as `team`). The
 * project's `jira:` block is looked up by that prefix when not passed. The
 * site is `config.site`, else the project's `jira.site`, else Settings.
 */
function createJiraTracker(config: TrackerConfig): JiraTracker {
  const projectKey = config.project ?? config.team;
  const jiraProject = config.jiraProject ?? (projectKey ? findProjectByTeam(projectKey)?.jira : undefined);
  const token = getTrackerKeyFromConfig('jira') || process.env.JIRA_API_TOKEN;
  const email = getTrackerKeyFromConfig('jiraEmail') || process.env.JIRA_EMAIL;
  const site = config.site || jiraProject?.site || getTrackerKeyFromConfig('jiraBaseUrl') || process.env.JIRA_BASE_URL;

  if (!token || !site) {
    throw new TrackerAuthError({ tracker: 'jira', message: jiraCredentialFix() });
  }
  if (!projectKey) {
    throw new Error('Jira tracker requires the project key (issue_prefix)');
  }

  return new JiraTracker({
    credentials: { token, site, ...(email ? { email } : {}) },
    projectKey,
    project: { ...jiraProject, site },
  });
}

/** Build the JiraTracker for a registered `tracker: jira` project. */
export function createJiraTrackerForProject(key: string, project: ProjectConfig): JiraTracker {
  const prefix = getIssuePrefix(project);
  if (!prefix) throw new Error(`Project ${key} has no issue_prefix; Jira uses it as the project key`);
  return createJiraTracker({ type: 'jira', project: prefix, site: project.jira?.site, jiraProject: project.jira ?? {} });
}

/** Build the JiraTracker that owns an issue key such as `PROJ-123`. */
export function createJiraTrackerForIssue(issueId: string): JiraTracker {
  const prefix = extractPrefix(issueId);
  if (!prefix) throw new Error(`Not a Jira issue key: ${issueId}`);
  return createJiraTracker({ type: 'jira', project: prefix });
}

/**
 * Create a tracker instance from configuration.
 * Priority: config.yaml (Settings) > environment variable > custom env var name
 */
export function createTracker(config: TrackerConfig): IssueTracker {
  switch (config.type) {
    case 'linear': {
      const configKey = getTrackerKeyFromConfig('linear');
      const envKey = config.apiKeyEnv
        ? process.env[config.apiKeyEnv]
        : process.env.LINEAR_API_KEY;
      const apiKey = configKey || envKey;

      if (!apiKey) {
        throw new TrackerAuthError({
          tracker: 'linear',
          message: `API key not found. Configure in Settings or set ${config.apiKeyEnv ?? 'LINEAR_API_KEY'} environment variable.`,
        });
      }

      return new LinearTracker(apiKey, { team: config.team });
    }

    case 'github': {
      const configKey = getTrackerKeyFromConfig('github');
      const envToken = config.tokenEnv
        ? process.env[config.tokenEnv]
        : process.env.GITHUB_TOKEN;
      const token = configKey || envToken;

      if (!token) {
        throw new TrackerAuthError({
          tracker: 'github',
          message: `Token not found. Configure in Settings or set ${config.tokenEnv ?? 'GITHUB_TOKEN'} environment variable.`,
        });
      }

      if (!config.owner || !config.repo) {
        throw new Error(
          'GitHub tracker requires owner and repo configuration'
        );
      }

      return new GitHubTracker(token, config.owner, config.repo);
    }

    case 'gitlab': {
      const configKey = getTrackerKeyFromConfig('gitlab');
      const envToken = config.tokenEnv
        ? process.env[config.tokenEnv]
        : process.env.GITLAB_TOKEN;
      const token = configKey || envToken;

      if (!token) {
        throw new TrackerAuthError({
          tracker: 'gitlab',
          message: `Token not found. Configure in Settings or set ${config.tokenEnv ?? 'GITLAB_TOKEN'} environment variable.`,
        });
      }

      if (!config.projectId) {
        throw new Error('GitLab tracker requires projectId configuration');
      }

      return new GitLabTracker(token, config.projectId);
    }

    case 'rally': {
      const configKey = getTrackerKeyFromConfig('rally');
      const envKey = config.apiKeyEnv
        ? process.env[config.apiKeyEnv]
        : process.env.RALLY_API_KEY;
      const apiKey = configKey || envKey;

      if (!apiKey) {
        throw new TrackerAuthError({
          tracker: 'rally',
          message: `API key not found. Configure in Settings or set ${config.apiKeyEnv ?? 'RALLY_API_KEY'} environment variable.`,
        });
      }

      return new RallyTracker({
        apiKey,
        server: config.server,
        workspace: config.workspace,
        project: config.project,
      });
    }

    case 'jira':
      return createJiraTracker(config);

    default:
      throw new Error(`Unknown tracker type: ${config.type}`);
  }
}

/**
 * Create tracker from trackers configuration section
 */
export function createTrackerFromConfig(
  trackersConfig: TrackersConfig,
  trackerType: TrackerType
): IssueTracker {
  const config = trackersConfig[trackerType];

  if (!config) {
    throw new Error(
      `No configuration found for tracker: ${trackerType}. Add [trackers.${trackerType}] to config.`
    );
  }

  return createTracker({ ...config, type: trackerType });
}

/**
 * Get the primary tracker from configuration
 */
export function getPrimaryTracker(trackersConfig: TrackersConfig): IssueTracker {
  return createTrackerFromConfig(trackersConfig, trackersConfig.primary);
}

/**
 * Get the secondary tracker from configuration (if configured)
 */
export function getSecondaryTracker(
  trackersConfig: TrackersConfig
): IssueTracker | null {
  if (!trackersConfig.secondary) {
    return null;
  }
  return createTrackerFromConfig(trackersConfig, trackersConfig.secondary);
}

/**
 * Get all configured trackers
 */
export function getAllTrackers(trackersConfig: TrackersConfig): IssueTracker[] {
  const trackers: IssueTracker[] = [getPrimaryTracker(trackersConfig)];

  const secondary = getSecondaryTracker(trackersConfig);
  if (secondary) {
    trackers.push(secondary);
  }

  return trackers;
}
