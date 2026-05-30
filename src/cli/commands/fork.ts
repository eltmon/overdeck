import chalk from 'chalk';
import { existsSync } from 'fs';
import { getConversationById, getConversationByName } from '../../lib/database/conversations-db.js';
import { forkConversationViaServer, ForkServerError } from './fork-client.js';
import { sessionFilePath } from '../../lib/paths.js';

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

  const sessionFile = conv.claudeSessionId ? sessionFilePath(conv.cwd, conv.claudeSessionId) : null;
  if (!sessionFile || !existsSync(sessionFile)) {
    console.log(chalk.yellow(`No session file found for conversation ${conv.name}`));
    process.exit(1);
  }

  const forkMode: 'plain' | 'summary' = options.plain ? 'plain' : 'summary';
  const modeLabel = forkMode === 'plain' ? 'plain fork' : 'summary fork';
  console.log(chalk.gray(`Creating ${modeLabel} from conversation: ${conv.name} (${conv.title || 'untitled'})`));
  console.log(chalk.gray('  Spawning the new session — this can take a moment…'));

  // PAN-1568: route through the dashboard server so the new conversation's tmux
  // session is actually spawned (the old in-process path created a row but never
  // spawned, leaving the fork born dead).
  let newConv;
  try {
    newConv = await forkConversationViaServer(conv.name, {
      model: options.model,
      cwd: options.cwd,
      forkMode,
    });
  } catch (err) {
    if (err instanceof ForkServerError) {
      console.log(chalk.red(err.message));
      process.exit(1);
    }
    throw err;
  }

  if (newConv.forkStatus === 'failed') {
    console.log(chalk.red(`${modeLabel} failed: ${newConv.forkError ?? 'unknown error'}`));
    process.exit(1);
  }

  console.log(chalk.green(`${modeLabel.charAt(0).toUpperCase() + modeLabel.slice(1)}ed conversation ${conv.name} → ${newConv.name}`));
  console.log(chalk.gray(`  Conv ID: ${newConv.id}`));
  console.log(chalk.gray(`  Session: ${newConv.tmuxSession}${newConv.sessionAlive ? ' (live)' : ''}`));
  console.log(chalk.gray(`  Model: ${newConv.model || 'default'}`));
  console.log(chalk.gray(`  Dashboard: https://pan.localhost/conv/${newConv.id}`));
}
