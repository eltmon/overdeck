/**
 * Pure status-mapping helpers for IssueDataService: raw tracker status →
 * canonical dashboard state, and canonical state → display label.
 */

/**
 * Map a raw status string to its canonical state.
 * Exported for testing.
 */
export function getCanonicalStatus(status: string | undefined, stateType?: string): string {
  if (!status) return 'backlog';
  const normalized = status.toLowerCase();
  // Direct backlog mappings
  if (normalized === 'backlog' || normalized === 'triage' || normalized === 'unknown') {
    return 'backlog';
  }
  // Other canonical states
  if (normalized === 'todo' || normalized === 'to do' || normalized === 'ready' || normalized === 'unstarted') {
    return 'todo';
  }
  if (normalized === 'in progress' || normalized === 'in_progress' || normalized === 'started' || normalized === 'active' || normalized === 'in planning') {
    return 'in_progress';
  }
  if (normalized === 'in review' || normalized === 'in_review' || normalized === 'review' || normalized === 'qa' || normalized === 'testing') {
    return 'in_review';
  }
  if (normalized === 'verifying' || normalized === 'verifying on main' || normalized === 'verifying_on_main') {
    return 'verifying_on_main';
  }
  if (normalized === 'done' || normalized === 'completed' || normalized === 'closed') {
    return 'done';
  }
  if (normalized === 'canceled' || normalized === 'cancelled' || normalized === 'duplicate' || normalized === "won't do" || normalized === 'wontfix') {
    return 'canceled';
  }
  // Fallback: use Linear stateType if available (handles custom status names)
  if (stateType) {
    const typeMap: Record<string, string> = {
      backlog: 'backlog',
      unstarted: 'todo',
      started: 'in_progress',
      completed: 'done',
      canceled: 'canceled',
      cancelled: 'canceled',
    };
    if (typeMap[stateType]) return typeMap[stateType];
  }
  return 'backlog'; // Default fallback
}

export function shouldRefreshPlanningStateForIssue(issue: any): boolean {
  const canonical = getCanonicalStatus(issue?.status, issue?.stateType);
  return canonical !== 'done' && canonical !== 'canceled';
}

/**
 * Display status for a canonical state — the same mapping the GitHub/Linear
 * fetch formatters apply inline, extracted for the PAN-3659 backfill adapter.
 */
export function displayStatusForCanonical(canonical: string): string {
  return canonical === 'todo' ? 'Todo' :
    canonical === 'in_progress' ? 'In Progress' :
    canonical === 'in_review' ? 'In Review' :
    canonical === 'verifying_on_main' ? 'Verifying' :
    canonical === 'done' ? 'Done' :
    canonical === 'canceled' ? 'Canceled' :
    canonical === 'backlog' ? 'Backlog' : 'Todo';
}

/**
 * Map normalized IssueState (open/in_progress/closed) to canonical dashboard status.
 * The Rally tracker already normalizes raw Rally states to IssueState in rally.ts.
 */
export function mapRallyStateToCanonical(issueState: string): string {
  if (!issueState) return 'todo';
  const stateLower = issueState.toLowerCase();
  if (stateLower === 'in_progress') return 'in_progress';
  if (stateLower === 'closed') return 'done';
  // 'open' and anything unrecognized → 'todo'
  return 'todo';
}
