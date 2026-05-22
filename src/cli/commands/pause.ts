import chalk from 'chalk';
import { getAgentStateSync, setAgentPausedSync, stopAgentSync } from '../../lib/agents.js';
import { resolveIssueIdSync } from '../../lib/issue-id.js';
import { sessionExistsSync } from '../../lib/tmux.js';

interface PauseOptions {
  reason?: string;
}

export async function pauseCommand(id: string, options: PauseOptions): Promise<void> {
  const issueId = resolveIssueIdSync(id);
  const agentId = `agent-${issueId.toLowerCase()}`;
  const state = getAgentStateSync(agentId);

  if (!state) {
    console.error(chalk.red(`Agent ${agentId} not found.`));
    process.exit(1);
  }

  const shouldStop = sessionExistsSync(agentId) || state.status === 'running' || state.status === 'starting';

  try {
    setAgentPausedSync(agentId, options.reason, shouldStop);
    if (shouldStop) {
      stopAgentSync(agentId);
    }

    const reason = options.reason ? ` (${options.reason})` : '';
    const stopped = shouldStop ? ' and stopped' : '';
    console.log(chalk.green(`Paused${stopped} agent: ${agentId}${reason}`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    process.exit(1);
  }
}
