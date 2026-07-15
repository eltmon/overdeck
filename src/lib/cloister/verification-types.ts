/** Shared verification contracts used by the runner and its process supervisor. */
export type VerificationRunnerOutcome =
  | { outcome: 'passed' }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'failed'; failedCheck: string; cycleCount: number; maxCycles: number }
  | { outcome: 'error'; message: string };

export interface WorkspaceInfo {
  isRemote: boolean;
  vmName?: string;
}
