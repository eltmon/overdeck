/**
 * The DTOs the project-creation page and hook share (PAN-3836 WI-4).
 *
 * One module rather than an interface per consumer: the previous shape drifted
 * between the page and the hook, and a mismatch there is invisible until a field
 * the server sends silently stops being rendered.
 */

export type ProjectCreateMode = 'clone' | 'existing' | 'new';

export type ProjectIntentField = 'url' | 'path' | 'parentDir' | 'name' | 'issuePrefix';

export interface ProjectIntentFinding {
  field: ProjectIntentField;
  code: string;
  message: string;
  detail?: string;
}

/** The safe projection of a resolved intent. `cloneUrl` arrives redacted. */
export interface ResolvedProjectIntent {
  mode: ProjectCreateMode;
  key: string | null;
  name: string;
  path: string | null;
  /** Server-resolved, always present — a real value, not a placeholder (D-4). */
  parentDir: string;
  /** The server's home directory. A browser cannot infer one. */
  homeDir: string;
  cloneUrl: string | null;
  provider: 'github' | 'gitlab' | null;
  repoSlug: string | null;
  defaultBranch: string | null;
  remoteChecked: boolean;
  isGitRepository: boolean;
  gitRoot: string | null;
  proposedIssuePrefix: string | null;
  wouldClone: boolean;
  wouldGitInit: boolean;
  willCreateMainWorkspace: boolean;
  registeredKeyAtPath: string | null;
  findings: ProjectIntentFinding[];
}

export type ProjectCreateFailureCode =
  | 'authentication-required'
  | 'host-key-untrusted'
  | 'remote-unreachable'
  | 'destination-conflict'
  | 'cancelled'
  | 'timed-out'
  | 'setup-incomplete'
  | 'operation-unknown'
  | 'internal-error';

export interface ProjectCreateFailure {
  code: ProjectCreateFailureCode;
  message: string;
  /** Sanitized and bounded; render only behind a disclosure. */
  detail?: string;
  retrySafe: boolean;
  recovery?:
    | { action: 'finish-setup'; key: string; path: string }
    | { action: 'use-existing'; path: string };
}

export interface ProjectCreateProgress {
  phase: string;
  percent: number | null;
}

export interface CreatedProject {
  key: string;
  name: string;
  path: string;
  mainWorkspaceId?: string;
}

/**
 * The submission state machine (§6.2).
 *
 * A discriminated union rather than independent booleans, because the booleans
 * permitted states that cannot be true at once — and one of them shipped: a
 * failed poll set `creating = false` while a clone was still running, so the
 * page showed a stale 42% *and* an error *and* an enabled Create button.
 */
export type ProjectSubmissionState =
  | { kind: 'editing' }
  | { kind: 'submitting'; operationId: string }
  | { kind: 'running'; operationId: string; jobId: string; progress: ProjectCreateProgress }
  | { kind: 'cancelling'; operationId: string; jobId: string }
  /** Contact lost. The operation is still ours; the outcome is simply unknown. */
  | {
      kind: 'connection-lost';
      operationId: string;
      jobId?: string;
      lastProgress?: ProjectCreateProgress;
      /** True once the retry budget is spent and only a manual check remains. */
      exhausted: boolean;
    }
  | {
      kind: 'needs-setup';
      operationId: string;
      key: string;
      path: string;
      failure: ProjectCreateFailure;
    }
  | { kind: 'failed'; failure: ProjectCreateFailure; retrySafe: boolean }
  | { kind: 'cancelled' }
  | { kind: 'done'; result: CreatedProject };

/** What is persisted so a reload can resume observing an operation (§6.2). */
export interface ProjectCreateObservation {
  version: 1;
  operationId: string;
  jobId?: string;
  mode: ProjectCreateMode;
  expectedKey: string;
  expectedPath: string;
  /** Provider identity only — never the transport URL, which may carry a token. */
  expectedRepoSlug?: string | null;
}

export const OBSERVATION_STORAGE_KEY = 'overdeck:project-create:v1';
