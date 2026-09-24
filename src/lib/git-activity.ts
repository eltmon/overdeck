/**
 * Git Activity Service (PAN-653)
 *
 * Write path and read path for git operation events persisted to the
 * git_operations SQLite table. Survives dashboard restart — unlike the
 * in-memory activityLog array which is capped at 100 and wiped on restart.
 *
 * All functions use the async-safe getDatabase() which runs under Node 22.
 * NEVER use execSync/readFileSync here — this runs in the dashboard server.
 */

import {
  appendGitOperation,
  listGitOperations,
} from './overdeck/git-activity.js';
import type {
  GitOperation,
  GitOperationFilter,
  GitOperationType,
  GitOperationStatus,
} from './overdeck/git-activity.js';

export type { GitOperation, GitOperationFilter, GitOperationType, GitOperationStatus };
export { appendGitOperation, listGitOperations };
