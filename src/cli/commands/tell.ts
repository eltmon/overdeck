import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { getAgentStateSync, messageAgent, resolveAgentTargetSync } from '../../lib/agents.js';
import { issueOwesReworkSync } from '../../lib/work-agent-lifecycle.js';
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
    return exitCli(1);
  }

  try {
    // Remote agents (fly.io) have no local tmux session — deliver via the
    // VM's tmux through the remote provider instead.
    const remoteState = loadRemoteAgentState(agentId);
    if (remoteState?.location === 'remote' && remoteState.vmName) {
      const remoteResult = await sendToRemoteAgent(agentId, remoteState.vmName, message);
      if (!remoteResult.ok) {
        console.error(chalk.red(`Message NOT delivered to ${agentId} (remote: ${remoteState.vmName})`));
        console.error(chalk.dim(`  "${message}"`));
        console.error(chalk.dim(`  ${remoteResult.failure ?? 'no reason reported'}`));
        return exitCli(1);
      }
      console.log(chalk.green('Message sent to ' + agentId + ' (remote: ' + remoteState.vmName + ')'));
      console.log(chalk.dim(`  "${message}"`));
      return;
    }

    const issueId = getAgentStateSync(agentId)?.issueId;
    const outcome = await messageAgent(agentId, message, 'pan-tell', {
      owesRework: issueOwesReworkSync(issueId),
    });
    if (!outcome.delivered) {
      console.error(chalk.red(`Message NOT delivered to ${agentId}`));
      console.error(chalk.dim(`  "${message}"`));
      console.error(chalk.dim(`  ${outcome.reason ?? 'no reason reported'}`));
      if (outcome.queuedToMail) {
        console.error(chalk.dim(`  The text is saved under ~/.overdeck/agents/${agentId}/mail/ for manual delivery.`));
      }
      return exitCli(1);
    }
    console.log(chalk.green(`Message delivered to ${agentId}${outcome.confirmed ? ' (turn confirmed)' : ''}`));
    console.log(chalk.dim(`  "${message}"`));
    // PAN-3736: when the delivery door explains itself — a busy agent whose
    // message went to its mail file, a dedup — print that reason. It names the
    // mail file, so the reader can check or hand-deliver the message.
    if (outcome.reason) {
      console.log(chalk.dim(`  ${outcome.reason}`));
    }
    return exitCli(0);
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    return exitCli(1);
  }
}
