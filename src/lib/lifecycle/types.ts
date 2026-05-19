/**
 * Shared types for lifecycle operations.
 *
 * Every atomic operation returns a StepResult. Workflows compose
 * multiple operations and return a WorkflowResult.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { IssueTracker } from '../tracker/interface.js';

export interface StepResult {
  step: string;
  success: boolean;
  skipped: boolean;     // true if operation was a no-op (idempotent)
  error?: string;
  details?: string[];   // human-readable log of what was done
}

export interface WorkflowResult {
  workflow: 'approve' | 'close' | 'close-out' | 'deep-wipe' | 'reset' | 'cancel';
  issueId: string;
  success: boolean;     // true only if ALL non-skipped steps succeeded
  steps: StepResult[];
  duration: number;     // ms
}

/** Context shared across lifecycle operations */
export interface LifecycleContext {
  issueId: string;
  projectPath: string;
  /** Project name (for Docker compose project naming + placeholders) */
  projectName?: string;
  /** GitHub issue metadata (populated for PAN- issues) */
  github?: {
    owner: string;
    repo: string;
    number: number;
  };
  /** Rally configuration (populated for Rally-tracked issues) */
  rally?: {
    apiKey: string;
    server?: string;
    workspace?: string;
    project?: string;
  };
  /** Issue tracker abstraction used by lifecycle operations when available */
  tracker?: IssueTracker;
  /** True when lifecycle work was started by Deacon automation rather than an operator */
  auto?: boolean;
}

/** Options for teardown-workspace */
export interface TeardownOptions {
  /** Delete feature branches (local + remote). Default: false */
  deleteBranches?: boolean;
  /** Skip Docker container cleanup. Default: false */
  skipDocker?: boolean;
  /** Delete workspace directory (worktree + files). Default: true */
  deleteWorkspace?: boolean;
  /** Clear beads for this issue from project root. Default: false.
   *  Only set to true for destructive wipe — normal completion should preserve beads. */
  clearBeads?: boolean;
  /** Project-specific workspace config for tunnel/Hume cleanup */
  workspaceConfig?: {
    tunnel?: any;
    hume?: any;
    dns?: { domain?: string };
  };
  /** Project name (for Docker compose project naming + placeholders) */
  projectName?: string;
}

/** Options for archive-planning */
export interface ArchiveOptions {
  /** Push git commits to remote after archiving. Default: true */
  pushToRemote?: boolean;
}

/** Options for the approve workflow */
export interface ApproveOptions {
  /** Skip the merge step (e.g. if already merged). Default: false */
  skipMerge?: boolean;
  /** Skip beads compaction. Default: false */
  skipBeadsCompaction?: boolean;
}

/** Options for the deep-wipe workflow */
/** Progress event emitted during deep-wipe. */
export interface DeepWipeProgress {
  step: number;
  total: number;
  label: string;
  detail: string;
  status: 'active' | 'complete' | 'error';
}

export interface DeepWipeOptions {
  /** IssueTracker instance for tracker-aware reset/cancel messages */
  tracker?: IssueTracker;
  /** Delete workspace directory. Default: true */
  deleteWorkspace?: boolean;
  /** Delete git branches (local + remote). Default: true */
  deleteBranches?: boolean;
  /** Reset issue to backlog/open state. Default: true */
  resetIssue?: boolean;
  /** Project-specific workspace config for tunnel/Hume cleanup */
  workspaceConfig?: {
    tunnel?: any;
    hume?: any;
    dns?: { domain?: string };
  };
  /** Project name (for Docker compose project naming + placeholders) */
  projectName?: string;
  /** Optional callback for streaming progress events to the client. */
  onProgress?: (event: DeepWipeProgress) => void;
}

/** Helper to create a successful step result */
export function stepOk(step: string, details?: string[]): StepResult {
  return { step, success: true, skipped: false, details };
}

/** Helper to create a skipped step result */
export function stepSkipped(step: string, details?: string[]): StepResult {
  return { step, success: true, skipped: true, details };
}

/** Helper to create a failed step result */
export function stepFailed(step: string, error: string, details?: string[]): StepResult {
  return { step, success: false, skipped: false, error, details };
}

/**
 * Get LINEAR_API_KEY from environment or .panopticon.env.
 * Shared across lifecycle modules.
 *
 * Kept as a sync function (not Effect-wrapped) because external callers
 * outside the lifecycle/ batch (src/lib/close-out.ts) consume it synchronously.
 * Those callers will migrate in their own batches.
 */
export async function getLinearApiKey(): Promise<string | null> {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = await readFile(envFile, 'utf-8');
    const match = content.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}
