/** Shared verification contracts used by the runner and its process supervisor. */
export type VerificationRunnerOutcome =
  | { outcome: 'passed' }
  | { outcome: 'skipped'; reason: string }
  | {
    outcome: 'deferred';
    reason: string;
    /**
     * PAN-4531: the agent committed past the head under verification, so the
     * run stopped. The supervisor restarts on the new head; doors never see it.
     */
    superseded?: { from: string | undefined; to: string | undefined };
  }
  | { outcome: 'failed'; failedCheck: string; cycleCount: number; maxCycles: number }
  | { outcome: 'error'; message: string };

export interface WorkspaceInfo {
  isRemote: boolean;
  vmName?: string;
}

export interface VerificationRunnerOptions {
  syncTargetBranch?: boolean;
  /** Strike workspaces intentionally have no vBRIEF checklist. */
  skipPlanChecklist?: boolean;
  /** PAN-2487: receives human-readable gate progress lines (ship-log mirror). */
  onGateLog?: (line: string) => void;
}
