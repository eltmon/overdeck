import { Effect } from 'effect';
import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { printAgentTargetFailure, resolveCliSingleAgentId } from '../agent-target.js';
import { clearAgentTroubled, getAgentState } from '../../lib/agents.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';

export async function untroubledCommand(id: string): Promise<void> {
  // PAN-1760: resolve through the shared resolver so full agent IDs
  // (strike-pan-1723, agent-…-ship) are addressable, not just issue IDs —
  // and so conversation numbers/names/URLs work too (PAN-4465).
  const target = await resolveCliSingleAgentId(id);
  if (!target.ok) {
    printAgentTargetFailure(target.failure, 'untroubled');
    return exitCli(1);
  }
  const agentId = target.agentId;
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
