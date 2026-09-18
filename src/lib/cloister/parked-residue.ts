/**
 * Operator-gate residue on terminal issues (PAN-3727, re-pointed by PAN-3917).
 *
 * The original sweep read every project's per-issue records, called an issue
 * terminal when the record said `closedOut` or `mergeStatus === 'merged'`, and
 * then acknowledged open "recovery trips" — a stored copy of a stored copy. The
 * records and the trip ledger are gone.
 *
 * What survives is the one real piece of residue: an agent row for a finished
 * issue still carrying an operator gate (stoppedByUser / paused / troubled),
 * which keeps the issue showing up as needing a human. Terminality now comes
 * from the owner of the fact — the tracker says the issue is closed, or the
 * forge says its PR merged.
 */
import type { ProjectConfig } from '../projects.js';

export interface ParkedResidueAction {
  message: string;
  level: 'action' | 'warn';
}

export interface TerminalIssueSignal {
  issueId: string;
  /** The tracker says the issue is closed. */
  issueClosed: boolean;
  /** The forge says the issue's PR merged. */
  prMerged: boolean;
}

export interface ParkedResiduePatrolDeps {
  /** Terminal-issue signals per project, from the tracker and the forge. */
  listTerminalIssues: (project: ProjectConfig) => Promise<TerminalIssueSignal[]>;
  clearGatesForIssues?: (issueIds: ReadonlySet<string>) => Map<string, string[]>;
}

/** An issue is terminal when its tracker issue is closed or its PR merged. */
export function isIssueTerminal(signal: TerminalIssueSignal): boolean {
  return signal.issueClosed || signal.prMerged;
}

async function defaultListTerminalIssues(project: ProjectConfig): Promise<TerminalIssueSignal[]> {
  const { gatherProjectLensSignals } = await import('../pipeline-membership-gather.js');
  const signals = await gatherProjectLensSignals(project);
  return signals.map((signal) => ({
    issueId: signal.issueId.toUpperCase(),
    issueClosed: !signal.issueOpen,
    prMerged: signal.hasMergedPr,
  }));
}

function defaultDeps(): ParkedResiduePatrolDeps {
  return { listTerminalIssues: defaultListTerminalIssues };
}

async function resolveClearGates(deps: ParkedResiduePatrolDeps) {
  return deps.clearGatesForIssues
    ?? (await import('../agents/agent-state.js')).clearAgentOperatorGatesForIssuesSync;
}

/**
 * Clear operator-gate residue from the agent rows of terminal issues.
 *
 * One batched agent-table scan per run (cost scales with the agent table, not
 * with the number of terminal issues). A project whose gather fails is warned
 * and skipped; it never aborts the sweep for the remaining projects.
 */
export async function reconcileTerminalIssueResidue(
  projects: Array<{ config: ProjectConfig }>,
  deps: ParkedResiduePatrolDeps = defaultDeps(),
): Promise<ParkedResidueAction[]> {
  const actions: ParkedResidueAction[] = [];

  const terminalIssueIds: string[] = [];
  for (const { config } of projects) {
    if (!config.path) continue;
    let signals: TerminalIssueSignal[];
    try {
      signals = await deps.listTerminalIssues(config);
    } catch (error) {
      actions.push({
        message: `Failed to read issue state for ${config.name ?? config.path}: ${error instanceof Error ? error.message : String(error)}`,
        level: 'warn',
      });
      continue;
    }
    for (const signal of signals) {
      if (isIssueTerminal(signal)) terminalIssueIds.push(signal.issueId.toUpperCase());
    }
  }

  if (terminalIssueIds.length === 0) return actions;

  const gatesByIssue = (await resolveClearGates(deps))(new Set(terminalIssueIds));

  for (const issueId of terminalIssueIds) {
    const gates = gatesByIssue.get(issueId) ?? [];
    if (gates.length === 0) continue;
    actions.push({
      message: `Cleaned parked residue for ${issueId}: cleared operator gates on ${gates.length} agent row(s)`,
      level: 'action',
    });
  }

  return actions;
}
