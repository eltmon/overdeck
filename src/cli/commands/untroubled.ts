import chalk from 'chalk';
import { clearAgentTroubledSync, getAgentStateSync } from '../../lib/agents.js';
import { resolveBareNumericIdSync } from '../../lib/issue-id.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';

export async function untroubledCommand(id: string): Promise<void> {
  const issueId = resolveBareNumericIdSync(id);
  if (!issueId) {
    console.error(chalk.red(`Could not resolve issue ID "${id}"`));
    console.error(chalk.dim(
      'Pass a fully-qualified ID like "PAN-1148", or ensure the agent state dir exists at ~/.panopticon/agents/agent-<prefix>-<num>/',
    ));
    process.exit(1);
  }
  const agentId = `agent-${issueId.toLowerCase()}`;
  const state = getAgentStateSync(agentId);

  if (!state) {
    console.error(chalk.red(`Agent ${agentId} not found.`));
    process.exit(1);
  }

  try {
    const wasTroubled = state.troubled === true || (state.consecutiveFailures ?? 0) > 0;
    clearAgentTroubledSync(agentId);

    if (wasTroubled) {
      await appendOperatorInterventionEvent({ issueId, kind: 'untroubled', source: 'pan untroubled' });
      console.log(chalk.green(`Cleared troubled state for agent: ${agentId}`));
    } else {
      console.log(chalk.dim(`Agent ${agentId} is already untroubled.`));
    }
    console.log(chalk.dim(`Run pan start ${issueId} to spawn now, or wait for the Deacon's next patrol.`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    process.exit(1);
  }
}
