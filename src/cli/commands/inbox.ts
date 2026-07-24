import chalk from 'chalk';
import { resolveAgentTargetSync } from '../../lib/agents.js';
import { listInboxMessagesSync } from '../../lib/agents/monitor-transport.js';

/**
 * `pan inbox [id]` — unary full-body re-read of an agent's mail (PAN-3015).
 * The monitor's stdout blocks truncate long bodies (the harness background
 * output surface caps them); this prints complete bodies, unread and already
 * read alike, and changes nothing on disk.
 */
export async function inboxCommand(id: string | undefined, options: { limit?: string }): Promise<void> {
  const rawTarget = id ?? process.env.OVERDECK_AGENT_ID;
  if (!rawTarget) {
    console.error(chalk.red('pan inbox: pass an agent id or set OVERDECK_AGENT_ID'));
    process.exit(1);
  }
  const agentId = resolveAgentTargetSync(rawTarget) ?? rawTarget;
  const limit = options.limit ? Number.parseInt(options.limit, 10) : 10;
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(chalk.red(`pan inbox: invalid --limit "${options.limit}"`));
    process.exit(1);
  }

  const messages = listInboxMessagesSync(agentId, limit);
  if (messages.length === 0) {
    console.log(chalk.dim(`No mail for ${agentId}`));
    return;
  }
  for (const message of messages) {
    const meta = [
      message.read ? 'read' : 'unread',
      message.source ? `source: ${message.source}` : null,
      message.date ? `at: ${message.date}` : null,
    ].filter(Boolean).join(' | ');
    console.log(chalk.dim(`--- ${message.file} (${meta}) ---`));
    console.log(message.body);
    console.log('');
  }
}
