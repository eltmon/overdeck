/** Shared verification contracts used by the runner and its process supervisor. */
export type VerificationRunnerOutcome =
  | { outcome: 'passed' }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'deferred'; reason: string }
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

export const INTERRUPTED_VERIFICATION_NOTE =
  'The supervised verification worker stopped before recording a result; a fresh terminal verification is required before merge.';

export function requiresFreshTerminalVerification(status: {
  verificationStatus?: string;
  verificationNotes?: string;
}): boolean {
  return status.verificationStatus === 'running'
    || status.verificationNotes === INTERRUPTED_VERIFICATION_NOTE;
}

export function freshTerminalVerificationError(
  status: { verificationStatus?: string; verificationNotes?: string },
  outcome: VerificationRunnerOutcome,
): string | undefined {
  if (!requiresFreshTerminalVerification(status) || outcome.outcome === 'passed') return undefined;
  const detail = outcome.outcome === 'error'
    ? outcome.message
    : outcome.outcome === 'skipped'
      ? outcome.reason
      : `unexpected ${outcome.outcome} outcome`;
  return `Fresh terminal verification required after worker interruption: ${detail}`;
}
