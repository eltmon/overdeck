import chalk from 'chalk';
import { getAgentState, setAgentPaused, stopAgent } from '../../lib/agents.js';
import { resolveIssueId } from '../../lib/issue-id.js';
import { sessionExists } from '../../lib/tmux.js';

interface PauseOptions {
  reason?: string;
}

export async function pauseCommand(id: string, options: PauseOptions): Promise<void> {
  const issueId = resolveIssueId(id);
  const agentId = `agent-${issueId.toLowerCase()}`;
  const state = getAgentState(agentId);

  if (!state) {
    console.error(chalk.red(`Agent ${agentId} not found.`));
    process.exit(1);
  }

  const wasRunning = sessionExists(agentId);

  try {
    setAgentPaused(agentId, options.reason);
    if (wasRunning) {
      stopAgent(agentId);
    }

    const reason = options.reason ? ` (${options.reason})` : '';
    const stopped = wasRunning ? ' and stopped' : '';
    console.log(chalk.green(`Paused${stopped} agent: ${agentId}${reason}`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    process.exit(1);
  }
}
