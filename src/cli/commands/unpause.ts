import chalk from 'chalk';
import { clearAgentPausedSync, getAgentStateSync } from '../../lib/agents.js';
import { resolveIssueIdSync } from '../../lib/issue-id.js';

export async function unpauseCommand(id: string): Promise<void> {
  const issueId = resolveIssueIdSync(id);
  const agentId = `agent-${issueId.toLowerCase()}`;
  const state = getAgentStateSync(agentId);

  if (!state) {
    console.error(chalk.red(`Agent ${agentId} not found.`));
    process.exit(1);
  }

  try {
    const wasPaused = state.paused === true;
    clearAgentPausedSync(agentId);

    if (wasPaused) {
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
