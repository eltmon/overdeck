/**
 * `pan start <id> --fresh` session recovery.
 *
 * --fresh wipes the work agent's state directory under
 * ~/.overdeck/agents/agent-<id>/ (PAN-1985) so the start that follows opens a
 * brand-new session against a clean dir. The new agent reads
 * .pan/continue.json, the xBRIEF, and the branch state to pick up where the
 * prior run left off.
 *
 * Operator note: --fresh is the deliberate override for harness/model switches
 * (where the saved Claude session cannot be resumed under a different harness)
 * and for "I want a clean work run" recovery. The NORMAL review flow continues
 * the same session across re-dispatches (PAN-1862); --fresh is the escape hatch
 * that pays the re-research cost. Workspace, xBRIEF, .pan/continue.json,
 * .pan/feedback/, branch, and commit history are all left untouched.
 *
 * PAN-3150: --fresh is SELF-SUFFICIENT. When a live tmux session exists it
 * cycles that session itself rather than refusing and telling the caller to run
 * `pan kill` first. Requiring a separate verb made the composite operation
 * impossible for the flywheel, which is forbidden `pan kill` — an
 * inert-but-alive agent then had no recovery door at all. Cycling a session is
 * not the one-way door `pan kill` is treated as: only the harness process is
 * replaced.
 *
 * For the narrow "just clear the four session tracking files" reset, use
 * `pan reset-session <id>` directly — it's intentionally non-destructive and is
 * used by the harness-policy subsystem as a building block.
 */
export interface FreshSessionResult {
  /** False when the live session could not be cycled; `error` explains why. */
  ok: boolean;
  /** Operator-facing progress lines to print on success. */
  messages: string[];
  /** Operator-facing failure line; set only when `ok` is false. */
  error?: string;
}

export async function prepareFreshWorkAgentSession(issueId: string): Promise<FreshSessionResult> {
  const agentId = `agent-${issueId.toLowerCase()}`;
  const messages: string[] = [];

  const { getAgentStateSync, stopAgentSync, wipeAgentStateDirs } = await import('../../lib/agents.js');
  const { sessionExistsSync } = await import('../../lib/tmux.js');

  const priorState = getAgentStateSync(agentId);

  if (sessionExistsSync(agentId)) {
    messages.push(`  --fresh: replacing the live session for ${agentId} (workspace, branch, and commits preserved)`);
    stopAgentSync(agentId);
    if (sessionExistsSync(agentId)) {
      return {
        ok: false,
        messages,
        error: `Agent ${agentId} still has a live tmux session after stopping it. Inspect it with 'tmux -L overdeck attach -t ${agentId}', then retry --fresh.`,
      };
    }
  }

  // No prior state → nothing to wipe; the caller falls through to the normal
  // start path, which creates the agent dir fresh.
  if (priorState) {
    const wipe = await wipeAgentStateDirs(issueId);
    messages.push(
      `  --fresh: wiped ${wipe.removed.length} agent state director${wipe.removed.length === 1 ? 'y' : 'ies'} for ${issueId} (path: ${wipe.path})`,
    );
  }

  return { ok: true, messages };
}
