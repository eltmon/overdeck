/**
 * pan conversations current — print the conversation the caller is running
 * inside (PAN-1520).
 *
 * This is the deterministic answer to "which conversation am I?" — agents
 * should use it (or `pan handoff` / `pan fork` with no arg) instead of scanning
 * and guessing.
 */

import chalk from 'chalk';
import { resolveCurrentConversation, currentTmuxSession } from '../../../lib/conversations/current.js';

export async function currentAction(opts: { json?: boolean }): Promise<void> {
  const conv = await resolveCurrentConversation();

  if (!conv) {
    if (opts.json) {
      console.log(JSON.stringify({ conversation: null, tmuxSession: await currentTmuxSession() }, null, 2));
      return;
    }
    console.error(chalk.yellow('Could not determine the current conversation.'));
    console.error(chalk.gray('  This command only resolves when run from inside a Overdeck conversation session.'));
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(conv, null, 2));
    return;
  }

  const field = (label: string, value: unknown): void => {
    const v = value == null ? chalk.dim('—') : String(value);
    console.log(`  ${chalk.bold(label.padEnd(14))} ${v}`);
  };

  console.log();
  console.log(chalk.bold(`Conversation #${conv.id}`));
  console.log(chalk.dim('─'.repeat(60)));
  field('Name', conv.name);
  field('Title', conv.title ?? '—');
  field('Status', conv.status);
  field('Model', conv.model ?? '—');
  field('Harness', conv.harness ?? 'claude-code');
  field('CWD', conv.cwd);
  field('tmux', conv.tmuxSession);
  field('Dashboard', `https://pan.localhost/conv/${conv.id}`);
  console.log();
}
