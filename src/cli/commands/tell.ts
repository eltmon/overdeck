import chalk from 'chalk';
import { messageAgent, normalizeAgentId } from '../../lib/agents.js';
import { loadRemoteAgentState, sendToRemoteAgent } from '../../lib/remote/index.js';

export async function tellCommand(id: string, message: string): Promise<void> {
  // normalizeAgentId preserves singleton IDs (flywheel-orchestrator) and known
  // prefixes (planning-, conv-, strike-, inspect-) instead of blindly
  // prepending 'agent-', which made `pan tell flywheel-orchestrator` resolve
  // a nonexistent agent and fail with "not running" (PAN-1749).
  const agentId = normalizeAgentId(id);

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
