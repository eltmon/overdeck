/**
 * pan conversations show <id> — show detailed conversation / session info (PAN-457).
 *
 * Resolution order (PAN-2018): the numeric `<id>` is first treated as a
 * **conversation** id (the same namespace `pan conv jsonl` and the dashboard
 * `/conv/<id>` route use). If no conversation matches, it falls back to the
 * `discovered_sessions` scan-order index — the original raw-session behavior —
 * so nothing that previously resolved through that index is lost.
 */

import chalk from 'chalk';

import { resolveConversationTranscript } from '../../../lib/conversations/transcript-path.js';
import { getConversationById, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import {
  getDiscoveredSessionByJsonlPath,
  getDiscoveredSessionById,
  type DiscoveredSession,
} from '../../../lib/overdeck/discovered-sessions.js';

export interface ShowActionOptions {
  json?: boolean;
}

interface Resolved {
  /** Which namespace the id was resolved through. */
  source: 'conversation' | 'session';
  /** The numeric id used for display. */
  displayId: number;
  conversation: LegacyConversation | null;
  session: DiscoveredSession | null;
}

function resolveShowTarget(id: number): Resolved | null {
  // 1. Conversation first (canonical — matches `pan conv jsonl` + dashboard).
  const conversation = getConversationById(id);
  if (conversation) {
    const transcript = resolveConversationTranscript(conversation.cwd, conversation.claudeSessionId);
    // Look up by the resolved path even if the file has expired/been pruned —
    // the discovered_sessions row may still hold the last-scan summary, tokens,
    // models, etc., which is more useful than showing nothing.
    const session = transcript.path
      ? getDiscoveredSessionByJsonlPath(transcript.path)
      : null;
    return { source: 'conversation', displayId: id, conversation, session };
  }

  // 2. Fallback: raw discovered-session scan-order index (pre-PAN-2018 behavior).
  const session = getDiscoveredSessionById(id);
  if (session) {
    return { source: 'session', displayId: session.id, conversation: null, session };
  }

  return null;
}

export async function showAction(id: string, opts: ShowActionOptions): Promise<void> {
  const numericId = parseInt(id, 10);
  if (isNaN(numericId)) {
    console.error(chalk.red(`Invalid ID: ${id}`));
    process.exit(1);
  }

  const resolved = resolveShowTarget(numericId);
  if (!resolved) {
    console.error(
      chalk.red(`No conversation or session found for ID ${numericId}.`),
    );
    console.error(
      chalk.gray(`  Tried conversation #${numericId} and discovered-session #${numericId}.`),
    );
    process.exit(1);
  }

  if (opts.json) {
    printJson(resolved);
    return;
  }

  printHuman(resolved);
}

const field = (label: string, value: unknown): void => {
  const v = value == null || value === '' ? chalk.dim('—') : String(value);
  console.log(`  ${chalk.bold(label.padEnd(18))} ${v}`);
};

const yn = (v: boolean) => (v ? chalk.green('yes') : chalk.dim('no'));

function printHuman(resolved: Resolved): void {
  const { source, displayId, conversation, session } = resolved;

  console.log();
  const header = source === 'conversation' ? `Conversation #${displayId}` : `Session #${displayId}`;
  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(60)));

  if (conversation) {
    field('Name', conversation.name);
    field('Title', conversation.title);
    field('Status', conversation.status);
    field('Model', conversation.model);
    field('Effort', conversation.effort);
    field('Harness', conversation.harness);
    field('CWD', conversation.cwd);
    field('tmux', conversation.tmuxSession);
    field('Issue', conversation.issueId);
    field('Created', conversation.createdAt);
    field('Ended', conversation.endedAt);
    field('Claude session', conversation.claudeSessionId);
    if (conversation.archivedAt) field('Archived', conversation.archivedAt);
  }

  if (session) {
    // Session-derived data (parsed from the JSONL transcript).
    if (conversation) console.log();
    field('JSONL path', session.jsonlPath);
    field('Workspace', session.workspacePath ?? '—');
    field('Messages', session.messageCount);
    field('First active', session.firstTs);
    field('Last active', session.lastTs);
    if (!conversation) {
      // Avoid duplicating model info already shown from the conversation.
      field('Primary model', session.primaryModel);
    }
    field('Models used', session.modelsUsed.join(', ') || '—');
    field('Input tokens', session.tokenInput);
    field('Output tokens', session.tokenOutput);
    field('Est. cost', session.estimatedCost > 0 ? `$${session.estimatedCost.toFixed(6)}` : '—');
    field('Tools used', session.toolsUsed.join(', ') || '—');
    field('Overdeck', yn(session.overdeckManaged));
    if (session.panIssueId) field('Issue ID', session.panIssueId);

    console.log();
    console.log(chalk.bold('Enrichment'));
    console.log(chalk.dim('─'.repeat(60)));
    field('Level', session.enrichmentLevel === 0 ? chalk.dim('none') : `L${session.enrichmentLevel}`);
    field('Model', session.enrichmentModel ?? '—');
    field('Failed', yn(session.enrichmentFailed));

    if (session.summary) {
      console.log();
      console.log(chalk.bold('Summary'));
      console.log(chalk.dim('─'.repeat(60)));
      console.log(`  ${session.summary}`);
    }

    if (session.summaryDetailed) {
      console.log();
      console.log(chalk.bold('Detailed Summary'));
      console.log(chalk.dim('─'.repeat(60)));
      console.log(`  ${session.summaryDetailed}`);
    }

    if (session.tags.length > 0) {
      console.log();
      console.log(chalk.bold('Tags'));
      console.log(chalk.dim('─'.repeat(60)));
      console.log(`  ${session.tags.map((t) => chalk.cyan(t)).join('  ')}`);
    }
  } else if (conversation) {
    // Conversation resolved but no scanned session row for its transcript yet.
    console.log();
    console.log(chalk.dim('No discovered-session data for this conversation\u2019s transcript yet.'));
  }

  console.log();
}

function printJson(resolved: Resolved): void {
  const { source, displayId, conversation, session } = resolved;
  // Always emit both keys (null when absent) for a stable JSON contract.
  const payload: Record<string, unknown> = {
    id: displayId,
    source,
    conversation: conversation
      ? {
          id: conversation.id,
          name: conversation.name,
          title: conversation.title,
          status: conversation.status,
          model: conversation.model,
          effort: conversation.effort,
          harness: conversation.harness,
          cwd: conversation.cwd,
          tmuxSession: conversation.tmuxSession,
          issueId: conversation.issueId,
          claudeSessionId: conversation.claudeSessionId,
          createdAt: conversation.createdAt,
          endedAt: conversation.endedAt,
        }
      : null,
    session,
  };
  console.log(JSON.stringify(payload, null, 2));
}
