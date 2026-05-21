/**
 * Issue Tracker Abstraction Layer
 *
 * Provides a unified interface for different issue tracking systems
 * (Linear, GitHub Issues, GitLab Issues, etc.)
 */

import { Data, Effect } from 'effect';
import type { TrackerError } from '../errors.js';

// Supported tracker types
export type TrackerType = 'linear' | 'github' | 'gitlab' | 'rally';

// Normalized issue state (lowest common denominator)
export type IssueState = 'open' | 'in_progress' | 'in_review' | 'closed';

// Normalized issue format
export interface Issue {
  /** Tracker-specific unique ID */
  id: string;

  /** Human-readable reference (e.g., MIN-630, #42) */
  ref: string;

  /** Issue title */
  title: string;

  /** Issue description/body (markdown) */
  description: string;

  /** Normalized state */
  state: IssueState;

  /** Labels/tags */
  labels: string[];

  /** Assignee username/name */
  assignee?: string;

  /** Web URL to the issue */
  url: string;

  /** Which tracker this issue came from */
  tracker: TrackerType;

  /** Cross-tracker linked issue references */
  linkedIssues?: string[];

  /** Priority (1=urgent, 2=high, 3=normal, 4=low) */
  priority?: number;

  /** Due date (ISO string) */
  dueDate?: string;

  /** Creation timestamp (ISO string) */
  createdAt: string;

  /** Last update timestamp (ISO string) */
  updatedAt: string;

  /** Parent issue FormattedID (e.g., "F1234") for Rally hierarchy */
  parentRef?: string;

  /** Rally artifact type (e.g., "HierarchicalRequirement", "PortfolioItem/Feature") */
  artifactType?: string;

  /** Raw tracker state name before normalization (e.g., "Discovering", "In-Progress") */
  rawState?: string;
}

// Comment on an issue
export interface Comment {
  id: string;
  issueId: string;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

// Filters for listing issues
export interface IssueFilters {
  /** Filter by state */
  state?: IssueState;

  /** Filter by labels (AND logic) */
  labels?: string[];

  /** Filter by assignee */
  assignee?: string;

  /** Filter by team/project (tracker-specific) */
  team?: string;

  /** Search query for title/description */
  query?: string;

  /** Maximum number of results */
  limit?: number;

  /** Include closed issues (default: false) */
  includeClosed?: boolean;
}

// Data for creating a new issue
export interface NewIssue {
  title: string;
  description?: string;
  labels?: string[];
  assignee?: string;
  team?: string;
  priority?: number;
  dueDate?: string;
}

// Data for updating an issue
export interface IssueUpdate {
  title?: string;
  description?: string;
  state?: IssueState;
  labels?: string[];
  assignee?: string;
  priority?: number;
  dueDate?: string;
}

/**
 * Abstract interface for issue trackers.
 * Implementations must handle normalization to/from tracker-specific formats.
 */
export interface IssueTracker {
  /** Tracker type identifier */
  readonly name: TrackerType;

  /**
   * List issues matching filters
   */
  listIssues(
    filters?: IssueFilters,
  ): Effect.Effect<Issue[], TrackerError | TrackerAuthError>;

  /**
   * Get a single issue by ID or ref
   * @param id - Issue ID or human-readable ref (e.g., "MIN-630", "#42")
   */
  getIssue(
    id: string,
  ): Effect.Effect<Issue, IssueNotFoundError | TrackerError | TrackerAuthError>;

  /**
   * Update an existing issue
   */
  updateIssue(
    id: string,
    update: IssueUpdate,
  ): Effect.Effect<Issue, IssueNotFoundError | TrackerError | TrackerAuthError>;

  /**
   * Create a new issue
   */
  createIssue(
    issue: NewIssue,
  ): Effect.Effect<Issue, TrackerError | TrackerAuthError>;

  /**
   * Get comments on an issue
   */
  getComments(
    issueId: string,
  ): Effect.Effect<Comment[], TrackerError | TrackerAuthError>;

  /**
   * Add a comment to an issue
   */
  addComment(
    issueId: string,
    body: string,
  ): Effect.Effect<Comment, TrackerError | TrackerAuthError>;

  /**
   * Transition issue to a new state
   */
  transitionIssue(
    id: string,
    state: IssueState,
  ): Effect.Effect<
    void,
    IssueNotFoundError | TrackerError | TrackerAuthError | NotImplementedError
  >;

  /**
   * Link a PR/MR to an issue
   */
  linkPR(
    issueId: string,
    prUrl: string,
  ): Effect.Effect<void, TrackerError | TrackerAuthError | NotImplementedError>;

  /**
   * Get child issues for a parent issue (hierarchy support).
   * Returns empty array for trackers that don't support hierarchy.
   */
  getChildIssues(
    parentId: string,
  ): Effect.Effect<Issue[], TrackerError | TrackerAuthError>;
}

/**
 * Error surfaced when a tracker feature is not implemented by a given adapter.
 */
export class NotImplementedError extends Data.TaggedError('NotImplementedError')<{
  readonly feature: string;
}> {}

/**
 * Error surfaced when a requested issue does not exist in the tracker.
 */
export class IssueNotFoundError extends Data.TaggedError('IssueNotFoundError')<{
  readonly id: string;
  readonly tracker: TrackerType;
}> {}

/**
 * Error surfaced when tracker authentication fails (missing or invalid credentials).
 */
export class TrackerAuthError extends Data.TaggedError('TrackerAuthError')<{
  readonly tracker: TrackerType;
  readonly message: string;
}> {}
