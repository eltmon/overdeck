/**
 * Typed errors for Effect services (PAN-449)
 *
 * All service errors use Data.TaggedError for type-safe error channels.
 * Route handlers can match on specific error tags with Effect.catchTag.
 */

import { Data } from 'effect';

// ─── Tracker errors ───────────────────────────────────────────────────────────

/** The requested tracker (linear, github, rally) is not configured. */
export class TrackerNotConfigured extends Data.TaggedError('TrackerNotConfigured')<{
  readonly tracker: string;
}> {}

/** The issue was not found in the tracker. */
export class IssueNotFound extends Data.TaggedError('IssueNotFound')<{
  readonly id: string;
}> {}

/** The tracker API returned a rate-limit response. */
export class RateLimited extends Data.TaggedError('RateLimited')<{
  readonly retryAfter: number;
}> {}

/** The tracker API returned an unexpected error. */
export class TrackerApiError extends Data.TaggedError('TrackerApiError')<{
  readonly tracker: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Workspace errors ─────────────────────────────────────────────────────────

/** The workspace directory for the given issue was not found. */
export class WorkspaceNotFound extends Data.TaggedError('WorkspaceNotFound')<{
  readonly id: string;
}> {}

/** Workspace creation failed. */
export class WorkspaceCreateError extends Data.TaggedError('WorkspaceCreateError')<{
  readonly id: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Agent errors ─────────────────────────────────────────────────────────────

/** An agent is already running for the given issue. */
export class AgentAlreadyRunning extends Data.TaggedError('AgentAlreadyRunning')<{
  readonly id: string;
}> {}

/** Beads tasks have not been initialized for this workspace. */
export class BeadsNotInitialized extends Data.TaggedError('BeadsNotInitialized')<{
  readonly workspace: string;
}> {}

/** The planning vBRIEF has no items — nothing to implement. */
export class PlanEmpty extends Data.TaggedError('PlanEmpty')<{
  readonly id: string;
}> {}

/** The agent process failed to start. */
export class AgentStartError extends Data.TaggedError('AgentStartError')<{
  readonly id: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
