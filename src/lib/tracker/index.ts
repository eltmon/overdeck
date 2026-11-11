/**
 * Issue Tracker Module
 *
 * Provides a unified interface for different issue tracking systems.
 */

// Core interface and types
export type {
  IssueTracker,
  Issue,
  IssueFilters,
  IssueState,
  IssueUpdate,
  NewIssue,
  Comment,
  TrackerType,
} from './interface.js';

export {
  NotImplementedError,
  IssueNotFoundError,
  TrackerAuthError,
} from './interface.js';

// Tracker implementations
export { LinearTracker } from './linear.js';
export { GitHubTracker } from './github.js';
export { GitLabTracker } from './gitlab.js';
export { JiraTracker } from './jira.js';
export type { JiraTrackerOptions } from './jira.js';
export type { JiraCredentials, JiraProjectConfig } from './jira-config.js';
export type { JiraTransition, JiraTransitionOutcome, JiraTransitionTarget } from './jira-status.js';

// Factory functions
export type { TrackerConfig } from './factory.js';
export {
  createTracker,
  createTrackerFromConfig,
  createJiraTrackerForProject,
  createJiraTrackerForIssue,
  getPrimaryTracker,
  getSecondaryTracker,
  getAllTrackers,
} from './factory.js';

// Cross-tracker linking
export type { TrackerLink, LinkDirection } from './linking.js';
export {
  LinkManager,
  getLinkManager,
  parseIssueRef,
  formatIssueRef,
} from './linking.js';
