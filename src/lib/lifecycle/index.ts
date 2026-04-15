/**
 * Lifecycle — Composable, idempotent post-merge operations.
 *
 * Atomic operations:
 *   archive-planning  — PRD active→completed + .planning/ preservation
 *   clean-planning    — Remove ephemeral .planning/ files from main after merge
 *   close-issue       — IssueTracker transition + label management
 *   teardown-workspace — Full workspace cleanup (agent, worktree, Docker, tmux)
 *   compact-beads     — Beads compaction + git commit/push
 *
 * Workflows (compose the above):
 *   approve()  — merge + close + archive + teardown + compact
 *   close()    — close + teardown
 *   closeOut() — verify-merged + archive + teardown + close + label + clear-status
 *   deepWipe() — teardown(deleteBranches) + delete agent state + reset issue
 */

// Types
export type {
  StepResult,
  WorkflowResult,
  LifecycleContext,
  TeardownOptions,
  ArchiveOptions,
  ApproveOptions,
  DeepWipeOptions,
} from './types.js';

export { stepOk, stepSkipped, stepFailed } from './types.js';

// Atomic operations (will be added as they are created)
export { archivePlanning } from './archive-planning.js';
export { cleanPlanningArtifacts } from './clean-planning.js';
export { closeIssue } from './close-issue.js';
export { teardownWorkspace } from './teardown-workspace.js';
export { compactBeads } from './compact-beads.js';

// Workflows
export { approve, close, closeOut, deepWipe, resetToTodo, cancelIssueWorkflow } from './workflows.js';
