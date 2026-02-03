import chalk from 'chalk';
import { listRunningAgents } from '../../../lib/agents.js';
import { isShadowed, getShadowState } from '../../../lib/shadow-state.js';

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  // Filter out invalid agent states (missing required fields)
  const agents = listRunningAgents().filter(agent =>
    agent.id && agent.issueId && agent.workspace
  );

  if (options.json) {
    // Add shadow mode info to JSON output
    const agentsWithShadow = agents.map(agent => {
      const shadowed = agent.issueId ? isShadowed(agent.issueId) : false;
      const shadowState = shadowed ? getShadowState(agent.issueId) : null;
      return {
        ...agent,
        shadowMode: shadowed,
        shadowStatus: shadowState?.shadowStatus,
        trackerStatus: shadowState?.trackerStatus,
      };
    });
    console.log(JSON.stringify(agentsWithShadow, null, 2));
    return;
  }

  if (agents.length === 0) {
    console.log(chalk.dim('No running agents.'));
    console.log(chalk.dim('Use "pan work issue <id>" to spawn one.'));
    return;
  }

  console.log(chalk.bold('\nRunning Agents\n'));

  for (const agent of agents) {
    const statusColor = agent.tmuxActive ? chalk.green : chalk.red;
    const status = agent.tmuxActive ? 'running' : 'stopped';

    const startedAt = new Date(agent.startedAt);
    const duration = Math.floor((Date.now() - startedAt.getTime()) / 1000 / 60);

    // Check shadow mode (only if issueId exists)
    const shadowed = agent.issueId ? isShadowed(agent.issueId) : false;
    const shadowState = shadowed ? getShadowState(agent.issueId) : null;

    console.log(`${chalk.cyan(agent.id)}`);
    console.log(`  Issue:    ${agent.issueId}`);
    console.log(`  Status:   ${statusColor(status)}`);

    if (shadowed && shadowState) {
      const statusStr = `${shadowState.shadowStatus}${shadowState.trackerStatus !== shadowState.shadowStatus ? ` (tracker: ${shadowState.trackerStatus})` : ''}`;
      console.log(`  Shadow:   ${chalk.cyan('👻')} ${statusStr}`);
    }

    console.log(`  Runtime:  ${agent.runtime} (${agent.model})`);
    console.log(`  Duration: ${duration} min`);
    console.log(`  Workspace: ${chalk.dim(agent.workspace)}`);
    console.log('');
  }

  // Show legend
  const anyShadowed = agents.some(agent => agent.issueId && isShadowed(agent.issueId));
  if (anyShadowed) {
    console.log(chalk.dim('👻 = Shadow mode (tracking status locally)'));
    console.log('');
  }
}
