/**
 * pan conversations jsonl <conv-id> — resolve a conversation's Claude JSONL path.
 */

import chalk from 'chalk';

import { getConversationById } from '../../../lib/overdeck/conversations.js';
import { resolveConversationTranscript } from '../../../lib/conversations/transcript-path.js';

export interface JsonlActionOptions {
  json?: boolean;
}

export async function jsonlAction(convId: string, opts: JsonlActionOptions): Promise<void> {
  if (!/^\d+$/.test(convId)) {
    console.error(chalk.red(`Invalid conversation ID: ${convId}`));
    process.exit(1);
  }

  const conversationId = Number(convId);
  const conversation = getConversationById(conversationId);
  if (!conversation) {
    console.error(chalk.red(`Conversation ${conversationId} not found`));
    process.exit(1);
  }

  const result = resolveConversationTranscript(conversation.cwd, conversation.claudeSessionId);

  if (opts.json) {
    console.log(JSON.stringify({
      status: result.status,
      path: result.path,
      conversationId: conversation.id,
      claudeSessionId: conversation.claudeSessionId,
      cwd: conversation.cwd,
    }, null, 2));
    return;
  }

  if (result.status === 'ok') {
    console.log(result.path);
    return;
  }

  if (result.status === 'expired') {
    console.error(chalk.red(`Transcript JSONL for conversation ${conversation.id} is not present on disk.`));
    console.error(chalk.gray(`  Expected path: ${result.path}`));
    console.error(chalk.gray('  Claude Code may have expired or pruned the session file; restore the JSONL to access the raw transcript.'));
    process.exit(1);
  }

  console.error(chalk.red(`Conversation ${conversation.id} has no claude_session_id recorded; transcript path is unknown.`));
  process.exit(1);
}
