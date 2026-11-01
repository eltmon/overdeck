import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { printAgentTargetFailure, resolveCliSingleAgentId } from '../agent-target.js';
import { getAgentState, messageAgent } from '../../lib/agents.js';
import { issueOwesRework } from '../../lib/work-agent-lifecycle.js';
import { loadRemoteAgentState, sendToRemoteAgent } from '../../lib/remote/index.js';
import { closeOpenDecisionOnOperatorMessage } from '../../lib/cloister/operator-decision.js';

export interface TellOptions {
  /** Deliver to a critic or verifier lane that already filed its verdict (PAN-4223 FR-16). */
  force?: boolean;
  /** Interrupt the running turn and send now: Claude Code's send-now chord (PAN-4292). */
  steer?: boolean;
  /** Queue the message on the server until the conversation's usage limit resets (PAN-4641). */
  whenLimitResets?: boolean;
  /** PAN-4650: idempotency key; a repeat with the same id is delivered once. */
  messageId?: string;
}

/**
 * PAN-4650 D-4650-21: `pan tell @<machine>/<conv>` delivers to a conversation a
 * linked machine runs, through this machine's dashboard and the link. The
 * owner's receipt store makes a repeated message id land once.
 */
export async function tellRemote(target: string, message: string, options: TellOptions): Promise<number> {
  const { isAgentSessionName, parseLinkedConversationName } = await import('@overdeck/contracts');
  const parsed = parseLinkedConversationName(target);
  if (!parsed || isAgentSessionName(parsed.name)) {
    console.error(chalk.red('pan tell @<label>/… targets conversations only'));
    return 1;
  }
  if (options.whenLimitResets || options.force) {
    console.error(chalk.red(`${options.whenLimitResets ? '--when-limit-resets' : '--force'} does not work for a conversation on another machine. Nothing was sent.`));
    return 1;
  }
  const { randomUUID } = await import('node:crypto');
  const { senderFromEnv } = await import('../../lib/terminal-backends/prompt-guard.js');
  const { callDashboard, errorText } = await import('./dashboard-call.js');
  const clientMessageId = options.messageId ?? randomUUID().replace(/-/g, '');
  let response: Response;
  try {
    response = await callDashboard(`/api/conversations/@${encodeURIComponent(parsed.target)}/${encodeURIComponent(parsed.name)}/message`, {
      method: 'POST',
      body: { message, clientMessageId, ...(options.steer ? { deliverAs: 'steer' } : {}) },
      headers: { 'x-overdeck-sender': senderFromEnv().id },
    });
  } catch (error) {
    console.error(chalk.red(`Message NOT delivered: the dashboard did not answer (${(error as Error).message})`));
    return 1;
  }
  if (!response.ok) {
    console.error(chalk.red(`Message NOT delivered to ${parsed.name} on ${parsed.target}: ${await errorText(response)}`));
    return 1;
  }
  console.log(chalk.green(`Delivered to ${parsed.name} on ${parsed.target}`));
  return 0;
}

function clockLabel(ms: number, now: number): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (at.toDateString() === new Date(now).toDateString()) return time;
  return `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function queuedReason(message: { resetSource: string | null; limitWindow: string | null }): string {
  if (message.resetSource === null) return 'no usage limit is active; sends within a minute';
  if (message.resetSource === 'fallback') return 'reset time unknown; tries again every 15 minutes';
  if (message.limitWindow === 'five_hour') return 'when the 5-hour limit resets';
  if (message.limitWindow === 'seven_day') return 'when the weekly limit resets';
  return 'when the usage limit resets';
}

/** PAN-4641: store the message on the server; the dashboard's scheduled-message patrol sends it. */
async function queueUntilLimitResets(agentId: string, message: string, options: TellOptions): Promise<void> {
  if (options.steer) {
    console.error(chalk.red('--steer cannot be combined with --when-limit-resets: a queued message has no running turn to interrupt. Nothing was queued.'));
    return exitCli(1);
  }
  if (!agentId.startsWith('conv-')) {
    console.error(chalk.red(`--when-limit-resets works only for conversations; ${agentId} is not one.`));
    return exitCli(1);
  }
  const name = agentId.slice('conv-'.length);
  const { scheduleConversationMessage } = await import('../../lib/overdeck/conversation-scheduled-messages.js');
  const result = await scheduleConversationMessage(name, message);
  switch (result.status) {
    case 'scheduled': {
      const notBefore = Date.parse(result.message.notBefore);
      console.log(chalk.green(`Queued for ${agentId}: sends at about ${clockLabel(notBefore, Date.now())} (${queuedReason(result.message)})`));
      console.log(chalk.dim(`  "${message}"`));
      console.log(chalk.dim(`  List queued messages with: pan conv pending ${agentId}`));
      return exitCli(0);
    }
    case 'not-found':
      console.error(chalk.red(`Conversation not found: ${agentId}. Nothing was queued.`));
      return exitCli(1);
    case 'queue-full':
      console.error(chalk.red(`${agentId} already has 20 queued messages (queue-full). Nothing was queued.`));
      return exitCli(1);
    case 'invalid':
      console.error(chalk.red(`Not queued (${result.code}): ${result.error}`));
      return exitCli(1);
  }
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
  // Any done report counts: a later blocked report does not reopen the verdict.
  const { listWorkerReports } = await import('../../lib/agents/worker/report.js');
  if (!(await listWorkerReports(agentId)).some((report) => report.status === 'done')) return null;
  return `conv ${row.id} is a ${row.laneRole} lane that already filed its verdict. ` +
    `Launch a fresh one: pan lane start --role ${row.laneRole} --for ${row.laneKey} …`;
}

export async function tellCommand(id: string, message: string, options: TellOptions = {}): Promise<void> {
  if (id.startsWith('@')) {
    const code = await tellRemote(id, message, options);
    return code === 0 ? undefined : exitCli(code);
  }
  // Resolve through the shared resolver so issue IDs can address non-work
  // agents such as strike-pan-* when that is the registered run, and so
  // conversation numbers/names/URLs work too (PAN-4465).
  const target = await resolveCliSingleAgentId(id);
  if (!target.ok) {
    printAgentTargetFailure(target.failure, 'tell');
    return exitCli(1);
  }
  const agentId = target.agentId;

  try {
    if (options.whenLimitResets) return await queueUntilLimitResets(agentId, message, options);

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
      if (options.steer) {
        console.error(chalk.red(`--steer is not supported for remote agents (${agentId} runs on ${remoteState.vmName}). Nothing was sent.`));
        console.error(chalk.dim('  Drop --steer to send a normal message.'));
        return exitCli(1);
      }
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
      ...(options.steer ? { steer: true } : {}),
      // PAN-4650: --message-id is the delivery door's idempotency key, so a repeat lands once.
      ...(options.messageId ? { dedupKey: options.messageId } : {}),
    });
    if (outcome.inputTargetRefusal) {
      console.error(chalk.red(`Message NOT delivered to ${agentId}: Claude Code's typed input could not be moved to the main agent.`));
      console.error(chalk.dim(`  "${message}"`));
      console.error(chalk.dim(`  ${outcome.inputTargetRefusal.reason}`));
      console.error(chalk.dim(`  The text is saved under ~/.overdeck/agents/${agentId}/mail/ for manual delivery.`));
      return exitCli(1);
    }
    if (outcome.landedInSubagent) {
      const { agentId: subagentId, description } = outcome.landedInSubagent;
      console.error(chalk.red(
        `Message NOT delivered to ${agentId}'s main conversation — it went to running subagent "${description}" (${subagentId})`,
      ));
      console.error(chalk.dim(`  "${message}"`));
      console.error(chalk.dim(`  ${outcome.reason ?? 'no reason reported'}`));
      return exitCli(1);
    }
    if (!outcome.delivered) {
      console.error(chalk.red(`Message NOT delivered to ${agentId}`));
      console.error(chalk.dim(`  "${message}"`));
      console.error(chalk.dim(`  ${outcome.reason ?? 'no reason reported'}`));
      if (outcome.queuedToMail) {
        console.error(chalk.dim(`  The text is saved under ~/.overdeck/agents/${agentId}/mail/ for manual delivery.`));
      }
      return exitCli(1);
    }
    // PAN-4383: a delivered operator message answers the agent's open `pan ask` decision.
    const closedDecision = closeOpenDecisionOnOperatorMessage(agentId, message, 'pan-tell');
    // PAN-4292: a steer that came back with a reason was delivered as a normal submit (an old
    // PTY supervisor); the headline must not claim it interrupted anything.
    const steered = options.steer && !outcome.reason;
    const deliveredVerb = steered ? `Message steered into ${agentId}'s running turn` : `Message delivered to ${agentId}${outcome.inputTarget === 'main' ? "'s main agent" : ''}`;
    console.log(chalk.green(`${deliveredVerb}${outcome.confirmed ? ' (turn confirmed)' : ''}`));
    console.log(chalk.dim(`  "${message}"`));
    if (outcome.switchedFromSubagent) {
      console.log(chalk.dim(`  Switched Claude Code's input from subagent "${outcome.switchedFromSubagent}" back to the main agent first.`));
    }
    // PAN-3736: when the delivery door explains itself — a busy agent whose
    // message went to its mail file, a dedup — print that reason. It names the
    // mail file, so the reader can check or hand-deliver the message.
    if (outcome.reason) {
      console.log(chalk.dim(`  ${outcome.reason}`));
    }
    if (closedDecision) {
      console.log(chalk.dim(`  Closed the open operator decision for ${agentId}.`));
    }
    return exitCli(0);
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    return exitCli(1);
  }
}
