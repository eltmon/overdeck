import { Effect } from 'effect';
import chalk from 'chalk';
import { stopAgentSync, getAgentStateSync } from '../../lib/agents.js';
import { sessionExistsSync } from '../../lib/tmux.js';
import { isRemoteAvailable } from '../../lib/remote/index.js';
import { killRemoteAgent } from '../../lib/remote/remote-agents.js';
import { resolveIssueIdSync } from '../../lib/issue-id.js';
import { stopWorkspaceDocker } from '../../lib/workspace-manager.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { findWorkspacePath } from '../../lib/lifecycle/archive-planning.js';

interface KillOptions {
  force?: boolean;
}

export async function killCommand(id: string, options: KillOptions): Promise<void> {
  // Support "agent-xxx" prefix, or just the issue ID
  const issueId = resolveIssueIdSync(id);
  const agentId = `agent-${issueId.toLowerCase()}`;

  // Check if exists
  const state = getAgentStateSync(agentId) as any;
  const isRunning = sessionExistsSync(agentId);

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
        stopAgentSync(agentId);
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
    stopAgentSync(agentId);
    console.log(chalk.green(`Killed agent: ${agentId}`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    process.exit(1);
  }

  // PAN-1316/PAN-1326: tear down the workspace Docker stack so dev-server
  // containers don't outlive their owning agent. Restart goes through a
  // different path that re-asserts stack health, so this is safe for
  // user-initiated kills only.
  //
  // Resolve the workspace from the issue (not from the agent's own state) so
  // killing a specialist (review/test/ship) — whose state.workspace may not
  // point at the work agent's workspace — still tears down the right stack.
  if (state?.issueId) {
    try {
      const issueLower = state.issueId.toLowerCase();
      const project = resolveProjectFromIssueSync(state.issueId);
      const projectPath = project?.projectPath ?? process.cwd();
      const workspacePath = findWorkspacePath(projectPath, issueLower);
      if (workspacePath) {
        const dockerResult = await Effect.runPromise(stopWorkspaceDocker(workspacePath, issueLower));
        if (dockerResult.containersFound) {
          console.log(chalk.gray(`Stopped Docker stack: ${dockerResult.steps.join('; ')}`));
        }
      }
    } catch (err: any) {
      console.warn(chalk.yellow(`Docker teardown warning: ${err?.message ?? err}`));
    }
  }
}
