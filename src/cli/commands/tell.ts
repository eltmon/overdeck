import chalk from 'chalk';
import { messageAgent } from '../../lib/agents.js';
import { loadRemoteAgentState, sendToRemoteAgent } from '../../lib/remote/index.js';

export async function tellCommand(id: string, message: string): Promise<void> {
  const agentId = id.startsWith('agent-') ? id : `agent-${id.toLowerCase()}`;

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
