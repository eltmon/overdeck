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
import type { TrackersConfig } from '../config.js';
import { loadConfigSync } from '../config-yaml.js';

// Configuration for a single tracker
export interface TrackerConfig {
  type: TrackerType;

  // Linear-specific
  apiKeyEnv?: string;
  api_key_env?: string;
  team?: string;

  // GitHub-specific
  tokenEnv?: string;
  token_env?: string;
  owner?: string;
  repo?: string;

  // GitLab-specific
  projectId?: string;
  project_id?: string;

  // Rally-specific
  server?: string;
  workspace?: string;
  project?: string;
}

export type TrackerKeyOverrides = Partial<Record<TrackerType, string>>;

// Multi-tracker configuration (re-exported from config.ts)
// Note: Use TrackersConfig from config.ts for full type with nested configs

function getTrackerKey(trackerType: TrackerType, overrides?: TrackerKeyOverrides): string | undefined {
  if (overrides) return overrides[trackerType];
  return loadConfigSync().config.trackerKeys[trackerType];
}

/**
 * Create a tracker instance from configuration.
 * Priority: explicit tracker key overrides > config.yaml tracker keys > environment variable > custom env var name
 */
export function createTracker(config: TrackerConfig, trackerKeys?: TrackerKeyOverrides): IssueTracker {
  switch (config.type) {
    case 'linear': {
      const configKey = getTrackerKey('linear', trackerKeys);
      const apiKeyEnv = config.apiKeyEnv ?? config.api_key_env;
      const envKey = apiKeyEnv
        ? process.env[apiKeyEnv]
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
      const configKey = getTrackerKey('github', trackerKeys);
      const tokenEnv = config.tokenEnv ?? config.token_env;
      const envToken = tokenEnv
        ? process.env[tokenEnv]
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
      const configKey = getTrackerKey('gitlab', trackerKeys);
      const tokenEnv = config.tokenEnv ?? config.token_env;
      const envToken = tokenEnv
        ? process.env[tokenEnv]
        : process.env.GITLAB_TOKEN;
      const token = configKey || envToken;

      if (!token) {
        throw new TrackerAuthError({
          tracker: 'gitlab',
          message: `Token not found. Configure in Settings or set ${config.tokenEnv ?? 'GITLAB_TOKEN'} environment variable.`,
        });
      }

      const projectId = config.projectId ?? config.project_id;
      if (!projectId) {
        throw new Error('GitLab tracker requires projectId configuration');
      }

      return new GitLabTracker(token, projectId);
    }

    case 'rally': {
      const configKey = getTrackerKey('rally', trackerKeys);
      const apiKeyEnv = config.apiKeyEnv ?? config.api_key_env;
      const envKey = apiKeyEnv
        ? process.env[apiKeyEnv]
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

    default:
      throw new Error(`Unknown tracker type: ${config.type}`);
  }
}

/**
 * Create tracker from trackers configuration section
 */
export function createTrackerFromConfig(
  trackersConfig: TrackersConfig,
  trackerType: TrackerType,
  trackerKeys?: TrackerKeyOverrides
): IssueTracker {
  const config = trackersConfig[trackerType];

  if (!config) {
    throw new Error(
      `No configuration found for tracker: ${trackerType}. Add [trackers.${trackerType}] to config.`
    );
  }

  return createTracker({ ...config, type: trackerType }, trackerKeys);
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
