import chalk from 'chalk';
import { messageAgent, resolveAgentTargetSync } from '../../lib/agents.js';
import { loadRemoteAgentState, sendToRemoteAgent } from '../../lib/remote/index.js';

export async function tellCommand(id: string, message: string): Promise<void> {
  // Resolve through the same target path as lifecycle commands so issue IDs can
  // address non-work agents such as strike-pan-* when that is the registered run.
  const agentId = resolveAgentTargetSync(id);
  if (!agentId) {
    console.error(chalk.red(`Could not resolve agent target "${id}"`));
    console.error(chalk.dim(
      'Pass an issue ID like "PAN-1148" or a full agent ID like "strike-pan-1723"; the state dir must exist under ~/.overdeck/agents/',
    ));
    process.exit(1);
  }

  try {
    // Remote agents (fly.io) have no local tmux session — deliver via the
    // VM's tmux through the remote provider instead.
    const remoteState = loadRemoteAgentState(agentId);
    if (remoteState?.location === 'remote' && remoteState.vmName) {
      await sendToRemoteAgent(agentId, remoteState.vmName, message);
      console.log(chalk.green('Message sent to ' + agentId + ' (remote: ' + remoteState.vmName + ')'));
      console.log(chalk.dim(`  "${message}"`));
      return;
    }

    await messageAgent(agentId, message, 'pan-tell');
    console.log(chalk.green('Message sent to ' + agentId));
    console.log(chalk.dim(`  "${message}"`));
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    process.exit(1);
  }
}
