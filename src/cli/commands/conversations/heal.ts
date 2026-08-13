import chalk from 'chalk';

import { exitCli } from '../../exit.js';
import { getDashboardApiUrlSync } from '../../../lib/config.js';
import { getConversationByName, listConversations } from '../../../lib/overdeck/conversations.js';

export async function healAction(query: string): Promise<void> {
  const exact = getConversationByName(query);
  const matches = exact ? [] : listConversations().filter(
    (conversation) => (conversation.title ?? '').toLowerCase().includes(query.toLowerCase()),
  );
  const conversation = exact ?? (matches.length === 1 ? matches[0] : null);
  if (!conversation) {
    console.error(chalk.red(`No conversation found matching "${query}"`));
    for (const candidate of matches) {
      console.error(chalk.dim(`  ${candidate.name}  ${candidate.title ?? '(untitled)'}`));
    }
    return exitCli(1);
  }

  try {
    const response = await fetch(
      `${getDashboardApiUrlSync()}/api/conversations/${encodeURIComponent(conversation.name)}/clear-fork-state`,
      { method: 'POST' },
    );
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      console.error(chalk.red(`Error: ${result.error ?? 'Failed to clear conversation failure state'}`));
      if (response.status === 409) {
        console.error('The tmux session is not alive; the stored failure state is truthful. Use pan conversations show <name> to inspect it.');
      }
      return exitCli(1);
    }
    console.log(chalk.green(`Cleared fork/spawn failure state for ${conversation.name} (session alive)`));
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    return exitCli(1);
  }
}
