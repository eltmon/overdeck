import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { Effect } from 'effect';
import { getAgentState, listAgentStates, resolveAgentTarget, setAgentPaused, stopAgent } from '../../lib/agents.js';
import { listSessionNamesSync } from '../../lib/tmux.js';
import { agentPaneExists } from '../../lib/terminal-backends/launch.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';

interface PauseOptions {
  reason?: string;
}

export async function pauseCommand(id: string, options: PauseOptions): Promise<void> {
  // PAN-1760: resolve through normalizeAgentId so full agent IDs
  // (strike-pan-1723, inspect-…, agent-…-ship) are addressable, not just issue IDs.
  const agentId = resolveAgentTarget(id);
  if (!agentId) {
    if (printSwarmPauseGuidance(id)) return exitCli(1);
    console.error(chalk.red(`Could not resolve agent target "${id}"`));
    console.error(chalk.dim(
      'Pass an issue ID like "PAN-1148" or a full agent ID like "strike-pan-1723"; the state dir must exist under ~/.overdeck/agents/',
    ));
    return exitCli(1);
  }
  const state = getAgentState(agentId);

  if (!state) {
    if (printSwarmPauseGuidance(id)) return exitCli(1);
    console.error(chalk.red(`Agent ${agentId} not found.`));
    return exitCli(1);
  }
  const issueId = state.issueId;

  // PAN-3947: a live terminal on the host's backend (tmux session or Herdr pane).
  const hasLivePane = await agentPaneExists(agentId).catch(() => false);
  const shouldStop = hasLivePane || state.status === 'running' || state.status === 'starting';

  try {
    await Effect.runPromise(setAgentPaused(agentId, options.reason, shouldStop));
    if (shouldStop) {
      // Async stop terminates through the terminal backend, so a Herdr pane
      // closes too — the sync variant could only reach a tmux session.
      await Effect.runPromise(stopAgent(agentId, 'operator'));
    }
    await appendOperatorInterventionEvent({ issueId, kind: 'pause', source: 'pan pause' });

    const reason = options.reason ? ` (${options.reason})` : '';
    const stopped = shouldStop ? ' and stopped' : '';
    console.log(chalk.green(`Paused${stopped} agent: ${agentId}${reason}`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    return exitCli(1);
  }
}

/**
 * A swarm issue has no single agent to pause — its work runs as slot agents
 * (agent-<issue>-slot-N). Detect that case and point the operator at the
 * swarm-level controls instead of a bare "not found" (PAN-2214).
 */
function printSwarmPauseGuidance(id: string): boolean {
  const issueId = id.replace(/^agent-/i, '').toUpperCase();
  const issueLower = issueId.toLowerCase();
  const escaped = issueLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const slotPattern = new RegExp(`^agent-${escaped}-slot-\\d+$`);
  const slotAgentIds = new Set<string>();
  try {
    // PAN-3917: agents/slot-reconcile.ts (listSlotAgents) is gone with the
    // Appendix A.5 reconcilers; the swarm-slot pattern match it did over
    // listAgentStates is inlined here — this is the only caller left.
    for (const agent of listAgentStates({ role: 'work' })) {
      if (slotPattern.test(agent.id)) slotAgentIds.add(agent.id);
    }
  } catch {
    // Agent registry unavailable — fall through to the live-session probe.
  }
  try {
    for (const sessionName of listSessionNamesSync()) {
      if (slotPattern.test(sessionName)) slotAgentIds.add(sessionName);
    }
  } catch {
    // No tmux server — no live slot sessions to count.
  }
  if (slotAgentIds.size === 0) return false;

  console.error(chalk.red(
    `${issueId} is running a swarm of ${slotAgentIds.size} slot agent(s) — a swarm has no single agent for \`pan pause\` to pause.`,
  ));
  console.error(
    `Run \`pan swarm stop ${issueId}\` to hold swarm coordination and stop every slot agent, `
    + `or \`pan swarm freeze ${issueId}\` to hold coordination while leaving running slot agents alive.`,
  );
  return true;
}
