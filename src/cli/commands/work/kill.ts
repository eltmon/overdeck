import chalk from 'chalk';
import { stopAgent, getAgentState } from '../../../lib/agents.js';
import { sessionExists } from '../../../lib/tmux.js';
import { createFlyProviderFromConfig, isRemoteAvailable } from '../../../lib/remote/index.js';
import { loadConfig } from '../../../lib/config.js';

interface KillOptions {
  force?: boolean;
}

export async function killCommand(id: string, options: KillOptions): Promise<void> {
  // Support "agent-xxx" prefix, or just the issue ID
  let agentId = id;
  if (!id.startsWith('agent-')) {
    agentId = `agent-${id.toLowerCase()}`;
  }

  // Check if exists
  const state = getAgentState(agentId) as any;
  const isRunning = sessionExists(agentId);

  if (!state && !isRunning) {
    console.log(chalk.yellow(`Agent ${agentId} not found.`));
    return;
  }

  // Handle remote agents
  if (state?.location === 'remote' && state?.vmName) {
    console.log(chalk.gray(`Remote agent on VM: ${state.vmName}`));
    try {
      const availability = await isRemoteAvailable();
      if (availability.available) {
        const fly = createFlyProviderFromConfig(loadConfig().remote);

        // Kill remote tmux session
        await fly.ssh(state.vmName, `tmux kill-session -t ${agentId} 2>/dev/null || true`);
        console.log(chalk.green(`Killed remote agent: ${agentId}`));

        // Update local state file
        stopAgent(agentId);
        return;
      } else {
        console.log(chalk.yellow(`Remote not available: ${availability.reason}`));
        console.log(chalk.gray('Cleaning up local state only...'));
      }
    } catch (error: any) {
      console.log(chalk.yellow(`Remote cleanup failed: ${error.message}`));
      console.log(chalk.gray('Cleaning up local state only...'));
    }
  }

  if (!options.force && isRunning) {
    // In a real implementation, we'd prompt for confirmation
    // For now, just proceed
  }

  try {
    stopAgent(agentId);
    console.log(chalk.green(`Killed agent: ${agentId}`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    process.exit(1);
  }
}
