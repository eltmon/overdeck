import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { getAgentState, messageAgent, resolveAgentTarget } from '../../lib/agents.js';
import { issueOwesRework } from '../../lib/work-agent-lifecycle.js';
import { loadRemoteAgentState, sendToRemoteAgent } from '../../lib/remote/index.js';

export interface TellOptions {
  /** Deliver to a critic or verifier lane that already filed its verdict (PAN-4223 FR-16). */
  force?: boolean;
}

/**
 * PAN-4223 FR-16: a critic or verifier lane gets one verdict. Re-tasking one
 * that already filed a done report would un-blind it, so the refusal names the
 * fresh-lane command instead. Null when delivery may proceed.
 */
async function laneVerdictRefusal(agentId: string): Promise<string | null> {
  if (!agentId.startsWith('conv-')) return null;
  const { getConversationByName } = await import('../../lib/overdeck/conversations.js');
  const row = getConversationByName(agentId.slice('conv-'.length));
  if (row?.laneRole !== 'critic' && row?.laneRole !== 'verifier') return null;
  const { latestWorkerReport } = await import('../../lib/agents/worker/report.js');
  if ((await latestWorkerReport(agentId))?.status !== 'done') return null;
  return `conv ${row.id} is a ${row.laneRole} lane that already filed its verdict. ` +
    `Launch a fresh one: pan lane start --role ${row.laneRole} --for ${row.laneKey} …`;
}

export async function tellCommand(id: string, message: string, options: TellOptions = {}): Promise<void> {
  // Resolve through the same target path as lifecycle commands so issue IDs can
  // address non-work agents such as strike-pan-* when that is the registered run.
  const agentId = resolveAgentTarget(id);
  if (!agentId) {
    console.error(chalk.red(`Could not resolve agent target "${id}"`));
    console.error(chalk.dim(
      'Pass an issue ID like "PAN-1148" or a full agent ID like "strike-pan-1723"; the state dir must exist under ~/.overdeck/agents/',
    ));
    return exitCli(1);
  }

  try {
    if (!options.force) {
      const refusal = await laneVerdictRefusal(agentId);
      if (refusal) {
        console.error(chalk.red(refusal));
        console.error(chalk.dim('  Pass --force to deliver anyway.'));
        return exitCli(1);
      }
    }

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

    const issueId = getAgentState(agentId)?.issueId;
    const outcome = await messageAgent(agentId, message, 'pan-tell', {
      owesRework: await issueOwesRework(issueId),
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
