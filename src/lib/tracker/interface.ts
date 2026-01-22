/**
 * Issue Tracker Abstraction Layer
 *
 * Provides a unified interface for different issue tracking systems
 * (Linear, GitHub Issues, GitLab Issues, etc.)
 */

// Supported tracker types
export type TrackerType = 'linear' | 'github' | 'gitlab' | 'rally';

// Normalized issue state (lowest common denominator)
export type IssueState = 'open' | 'in_progress' | 'closed';

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
  listIssues(filters?: IssueFilters): Promise<Issue[]>;

  /**
   * Get a single issue by ID or ref
   * @param id - Issue ID or human-readable ref (e.g., "MIN-630", "#42")
   */
  getIssue(id: string): Promise<Issue>;

  /**
   * Update an existing issue
   */
  updateIssue(id: string, update: IssueUpdate): Promise<Issue>;

  /**
   * Create a new issue
   */
  createIssue(issue: NewIssue): Promise<Issue>;

  /**
   * Get comments on an issue
   */
  getComments(issueId: string): Promise<Comment[]>;

  /**
   * Add a comment to an issue
   */
  addComment(issueId: string, body: string): Promise<Comment>;

  /**
   * Transition issue to a new state
   */
  transitionIssue(id: string, state: IssueState): Promise<void>;

  /**
   * Link a PR/MR to an issue
   */
  linkPR(issueId: string, prUrl: string): Promise<void>;
}

/**
 * Error thrown when a tracker feature is not implemented
 */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`Not implemented: ${feature}`);
    this.name = 'NotImplementedError';
  }
}

/**
 * Error thrown when an issue is not found
 */
export class IssueNotFoundError extends Error {
  constructor(id: string, tracker: TrackerType) {
    super(`Issue not found: ${id} (tracker: ${tracker})`);
    this.name = 'IssueNotFoundError';
  }
}

/**
 * Error thrown when tracker authentication fails
 */
export class TrackerAuthError extends Error {
  constructor(tracker: TrackerType, message: string) {
    super(`Authentication failed for ${tracker}: ${message}`);
    this.name = 'TrackerAuthError';
  }
}
