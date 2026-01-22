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

  // Rally-specific
  server?: string;
  workspace?: string;
  project?: string;
}

// Multi-tracker configuration (re-exported from config.ts)
// Note: Use TrackersConfig from config.ts for full type with nested configs

/**
 * Create a tracker instance from configuration
 */
export function createTracker(config: TrackerConfig): IssueTracker {
  switch (config.type) {
    case 'linear': {
      const apiKey = config.apiKeyEnv
        ? process.env[config.apiKeyEnv]
        : process.env.LINEAR_API_KEY;

      if (!apiKey) {
        throw new TrackerAuthError(
          'linear',
          `API key not found. Set ${config.apiKeyEnv ?? 'LINEAR_API_KEY'} environment variable.`
        );
      }

      return new LinearTracker(apiKey, { team: config.team });
    }

    case 'github': {
      const token = config.tokenEnv
        ? process.env[config.tokenEnv]
        : process.env.GITHUB_TOKEN;

      if (!token) {
        throw new TrackerAuthError(
          'github',
          `Token not found. Set ${config.tokenEnv ?? 'GITHUB_TOKEN'} environment variable.`
        );
      }

      if (!config.owner || !config.repo) {
        throw new Error(
          'GitHub tracker requires owner and repo configuration'
        );
      }

      return new GitHubTracker(token, config.owner, config.repo);
    }

    case 'gitlab': {
      const token = config.tokenEnv
        ? process.env[config.tokenEnv]
        : process.env.GITLAB_TOKEN;

      if (!token) {
        throw new TrackerAuthError(
          'gitlab',
          `Token not found. Set ${config.tokenEnv ?? 'GITLAB_TOKEN'} environment variable.`
        );
      }

      if (!config.projectId) {
        throw new Error('GitLab tracker requires projectId configuration');
      }

      return new GitLabTracker(token, config.projectId);
    }

    case 'rally': {
      const apiKey = config.apiKeyEnv
        ? process.env[config.apiKeyEnv]
        : process.env.RALLY_API_KEY;

      if (!apiKey) {
        throw new TrackerAuthError(
          'rally',
          `API key not found. Set ${config.apiKeyEnv ?? 'RALLY_API_KEY'} environment variable.`
        );
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
