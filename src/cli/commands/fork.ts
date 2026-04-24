import chalk from 'chalk';
import { existsSync } from 'fs';
import { getConversationById, getConversationByName } from '../../lib/database/conversations-db.js';
import { createSummaryFork } from '../../lib/conversations/summary-fork.js';

interface ForkOptions {
  model?: string;
  cwd?: string;
  plain?: boolean;
}

export async function forkCommand(
  convRef: string,
  options: ForkOptions,
): Promise<void> {
  // Resolve conversation by ID (numeric) or name
  let conv: any = null;
  if (/^\d+$/.test(convRef)) {
    conv = getConversationById(parseInt(convRef, 10));
  } else {
    conv = getConversationByName(convRef);
  }

  if (!conv) {
    console.log(chalk.yellow(`Conversation not found: ${convRef}`));
    process.exit(1);
  }

  if (!conv.sessionFile || !existsSync(conv.sessionFile)) {
    console.log(chalk.yellow(`No session file found for conversation ${conv.name}`));
    process.exit(1);
  }

  const modeLabel = options.plain ? 'plain fork' : 'summary fork';
  console.log(chalk.gray(`Creating ${modeLabel} from conversation: ${conv.name} (${conv.title || 'untitled'})`));

  const newConv = (await createSummaryFork(conv, options)).conversation;

  console.log(chalk.green(`${modeLabel.charAt(0).toUpperCase() + modeLabel.slice(1)}ed conversation ${conv.name} → ${newConv.name}`));
  console.log(chalk.gray(`  Conv ID: ${newConv.id}`));
  console.log(chalk.gray(`  Session: ${newConv.tmuxSession}`));
  console.log(chalk.gray(`  Model: ${newConv.model || 'default'}`));
  console.log(chalk.gray(`  Dashboard: https://pan.localhost/conv/${newConv.id}`));
}
