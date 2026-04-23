/**
 * Reconciler types (PAN-805).
 */

export type CanonicalState =
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'merged'
  | 'closed_wontfix';

export interface ReconcilerConfig {
  /** Tick interval in milliseconds (default: 30000) */
  intervalMs: number;
  /** GitHub API token */
  githubToken: string;
  /** GitHub repo owner/name (e.g. "eltmon/panopticon-cli") */
  repo: string;
}

export interface LabelIntent {
  issueId: string;
  label: string;
  action: 'add' | 'remove';
  retryCount: number;
}

export interface ReconcilerState {
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
  mutex: boolean;
}
