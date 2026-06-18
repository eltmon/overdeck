import chalk from 'chalk';
import { clearAgentPausedSync, getAgentStateSync, resolveAgentTargetSync } from '../../lib/agents.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';

export async function unpauseCommand(id: string): Promise<void> {
  // PAN-1760: resolve through normalizeAgentId so full agent IDs
  // (strike-pan-1723, inspect-…, agent-…-ship) are addressable, not just issue IDs.
  const agentId = resolveAgentTargetSync(id);
  if (!agentId) {
    console.error(chalk.red(`Could not resolve agent target "${id}"`));
    console.error(chalk.dim(
      'Pass an issue ID like "PAN-1148" or a full agent ID like "strike-pan-1723"; the state dir must exist under ~/.overdeck/agents/',
    ));
    process.exit(1);
  }
  const state = getAgentStateSync(agentId);

  if (!state) {
    console.error(chalk.red(`Agent ${agentId} not found.`));
    process.exit(1);
  }
  const issueId = state.issueId;

  try {
    const wasPaused = state.paused === true;
    clearAgentPausedSync(agentId);

    if (wasPaused) {
      await appendOperatorInterventionEvent({ issueId, kind: 'unpause', source: 'pan unpause' });
      console.log(chalk.green(`Unpaused agent: ${agentId}`));
    } else {
      console.log(chalk.dim(`Agent ${agentId} is already unpaused.`));
    }
    console.log(chalk.dim(`Run pan start ${issueId} to spawn now, or wait for the Deacon's next patrol.`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    process.exit(1);
  }
}
