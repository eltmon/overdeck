import chalk from 'chalk';
import { stopAgent, getAgentState } from '../../lib/agents.js';
import { sessionExists } from '../../lib/tmux.js';
import { isRemoteAvailable } from '../../lib/remote/index.js';
import { killRemoteAgent } from '../../lib/remote/remote-agents.js';
import { resolveIssueId } from '../../lib/issue-id.js';
import { stopWorkspaceDocker } from '../../lib/workspace-manager.js';

interface KillOptions {
  force?: boolean;
}

export async function killCommand(id: string, options: KillOptions): Promise<void> {
  // Support "agent-xxx" prefix, or just the issue ID
  const issueId = resolveIssueId(id);
  const agentId = `agent-${issueId.toLowerCase()}`;

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
        await killRemoteAgent(agentId, state.vmName);
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

  // PAN-1316: tear down the workspace Docker stack so dev-server containers
  // don't outlive their owning agent. Restart goes through a different path
  // that re-asserts stack health, so this is safe for user-initiated kills only.
  if (state?.workspace && state?.issueId) {
    try {
      const dockerResult = await stopWorkspaceDocker(state.workspace, state.issueId.toLowerCase());
      if (dockerResult.containersFound) {
        console.log(chalk.gray(`Stopped Docker stack: ${dockerResult.steps.join('; ')}`));
      }
    } catch (err: any) {
      console.warn(chalk.yellow(`Docker teardown warning: ${err?.message ?? err}`));
    }
  }
}
