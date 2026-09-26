import { Effect } from 'effect';
import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { clearAgentTroubled, getAgentState, resolveAgentTarget } from '../../lib/agents.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';

export async function untroubledCommand(id: string): Promise<void> {
  // PAN-1760: resolve through normalizeAgentId so full agent IDs
  // (strike-pan-1723, agent-…-ship) are addressable, not just issue IDs.
  const agentId = resolveAgentTarget(id);
  if (!agentId) {
    console.error(chalk.red(`Could not resolve agent target "${id}"`));
    console.error(chalk.dim(
      'Pass an issue ID like "PAN-1148" or a full agent ID like "strike-pan-1723"; the state dir must exist under ~/.overdeck/agents/',
    ));
    return exitCli(1);
  }
  const state = getAgentState(agentId);
  if (!state) {
    console.error(chalk.red(`Agent ${agentId} not found.`));
    return exitCli(1);
  }
  const issueId = state.issueId;

  try {
    const wasTroubled = state.troubled === true || (state.consecutiveFailures ?? 0) > 0;
    await Effect.runPromise(clearAgentTroubled(agentId));
    if (wasTroubled) {
      await appendOperatorInterventionEvent({ issueId, kind: 'untroubled', source: 'pan untroubled' });
      console.log(chalk.green(`Cleared troubled state for agent: ${agentId}`));
      console.log(chalk.dim(`Run pan start ${issueId} to spawn it.`));
    } else {
      console.log(chalk.dim(`Agent ${agentId} is already untroubled.`));
    }
  } catch (error: unknown) {
    console.error(chalk.red('Error: ' + (error instanceof Error ? error.message : String(error))));
    return exitCli(1);
  }
}
