import chalk from 'chalk';
import {
  getConversationByName,
  listArchivedConversations,
  unarchiveConversation,
} from '../../lib/database/conversations-db.js';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export async function unarchiveConversationCommand(query: string): Promise<void> {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    console.log(chalk.yellow('Provide a conversation name or title to unarchive.'));
    process.exit(1);
  }

  const byName = getConversationByName(query);
  if (byName?.archivedAt) {
    unarchiveConversation(byName.name);
    console.log(chalk.green(`Unarchived conversation ${byName.name}`));
    console.log(chalk.gray(`  Title: ${byName.title || 'untitled'}`));
    return;
  }
  if (byName && !byName.archivedAt) {
    console.log(chalk.yellow(`Conversation ${byName.name} is already active`));
    return;
  }

  const archived = listArchivedConversations();
  const exactTitleMatches = archived.filter((conv) => normalize(conv.title || '') === normalizedQuery);
  const partialTitleMatches = archived.filter((conv) => normalize(conv.title || '').includes(normalizedQuery));
  const matches = exactTitleMatches.length > 0 ? exactTitleMatches : partialTitleMatches;

  if (matches.length === 0) {
    console.log(chalk.yellow(`No archived conversation matched: ${query}`));
    process.exit(1);
  }

  if (matches.length > 1) {
    console.log(chalk.yellow(`Multiple archived conversations matched: ${query}`));
    for (const conv of matches.slice(0, 10)) {
      console.log(chalk.gray(`  ${conv.name} — ${conv.title || 'untitled'}`));
    }
    console.log(chalk.dim('Use the exact conversation name to disambiguate.'));
    process.exit(1);
  }

  const match = matches[0];
  unarchiveConversation(match.name);
  console.log(chalk.green(`Unarchived conversation ${match.name}`));
  console.log(chalk.gray(`  Title: ${match.title || 'untitled'}`));
}
