/**
 * pan conversations pending <conv> — list the messages queued to send when
 * the conversation's usage limit resets (PAN-4641 WI-9). Delivered rows are
 * not shown; queue them with `pan tell --when-limit-resets`.
 */

import chalk from 'chalk';
import { exitCli } from '../../exit.js';
import { printAgentTargetFailure, resolveCliSingleAgentId } from '../../agent-target.js';
import { listScheduledMessages } from '../../../lib/overdeck/conversation-scheduled-messages.js';

const PREVIEW_CHARS = 60;

function preview(text: string): string {
  const flat = text.replace(/\r?\n/g, '⏎');
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export async function pendingAction(conv: string, opts: { json?: boolean }): Promise<void> {
  const target = await resolveCliSingleAgentId(conv);
  if (!target.ok) {
    printAgentTargetFailure(target.failure, 'conv pending');
    return exitCli(1);
  }
  if (!target.agentId.startsWith('conv-')) {
    console.error(chalk.red(`pan conv pending works only for conversations; ${target.agentId} is not one.`));
    return exitCli(1);
  }
  const messages = listScheduledMessages(target.agentId.slice('conv-'.length));
  if (opts.json) {
    console.log(JSON.stringify(messages, null, 2));
    return;
  }
  if (messages.length === 0) {
    console.log(`No queued messages for ${conv}.`);
    return;
  }
  for (const message of messages) {
    console.log(`#${message.id}  ${message.status}  ${localTime(message.notBefore)}  ${preview(message.text)}`);
    if (message.lastError) console.log(chalk.dim(`  last error: ${message.lastError}`));
  }
}
