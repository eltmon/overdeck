/**
 * pan conversations move <query> <projectKey> — reassign a conversation's
 * project via the project_key override (PAN-1577).
 *
 * <query> resolves against the live conversations table: exact name match
 * first, then a fuzzy title match. No match or an ambiguous (multiple)
 * fuzzy match is a non-zero exit with a clear message listing candidates.
 */

import chalk from 'chalk';

import { exitCli } from '../../exit.js';
import { getDashboardApiUrlSync } from '../../../lib/config.js';
import { getConversationByName, listConversations, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { getProjectSync, listProjectsSync } from '../../../lib/projects.js';

const DASHBOARD_URL = getDashboardApiUrlSync();

interface ResolveResult {
  conversation: LegacyConversation | null;
  candidates: LegacyConversation[];
}

function resolveConversation(query: string): ResolveResult {
  const exact = getConversationByName(query);
  if (exact) return { conversation: exact, candidates: [] };

  const q = query.toLowerCase();
  const candidates = listConversations().filter((c) => (c.title ?? '').toLowerCase().includes(q));
  if (candidates.length === 1) return { conversation: candidates[0], candidates: [] };
  return { conversation: null, candidates };
}

/**
 * The project a conversation effectively belongs to (PAN-1577): the explicit
 * project_key override when set, otherwise the registered project whose path
 * contains its cwd. Must agree with the server's and frontend's identically-named
 * resolvers, or the CLI's "from" label would show "(no project)" for a
 * cwd-grouped conversation the server considers already-in-project (a no-op).
 */
function resolveEffectiveProjectKey(conv: { cwd: string; projectKey: string | null }): string | null {
  if (conv.projectKey) return conv.projectKey;
  const matched = listProjectsSync().find(
    ({ config }) => config.path && (conv.cwd === config.path || conv.cwd.startsWith(config.path + '/')),
  );
  return matched?.key ?? null;
}

function projectLabel(key: string | null): string {
  if (!key) return '(no project)';
  return getProjectSync(key)?.name ?? key;
}

export async function moveAction(query: string, projectKey: string): Promise<void> {
  const { conversation, candidates } = resolveConversation(query);

  if (!conversation) {
    if (candidates.length === 0) {
      console.error(chalk.red(`No conversation found matching "${query}"`));
    } else {
      console.error(chalk.red(`Ambiguous match for "${query}" — ${candidates.length} candidates:`));
      for (const c of candidates) {
        console.error(chalk.dim(`  ${c.name}  ${c.title ?? '(untitled)'}`));
      }
    }
    return exitCli(1);
  }

  const fromLabel = projectLabel(resolveEffectiveProjectKey(conversation));

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/conversations/${encodeURIComponent(conversation.name)}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectKey }),
    });

    const result = await response.json() as { error?: string; projectKey?: string | null };

    if (!response.ok) {
      console.error(chalk.red(`Error: ${result.error || 'Failed to move conversation'}`));
      return exitCli(1);
    }

    const toLabel = projectLabel(result.projectKey ?? projectKey);
    console.log(chalk.green(`✓ Moved "${conversation.title ?? conversation.name}" from ${fromLabel} to ${toLabel}`));
  } catch (error: unknown) {
    // Node 22's global fetch throws `TypeError: fetch failed` for a refused
    // connection, with the real errno on `.cause.code` — not a top-level
    // `.code` (that shape never occurs for a native fetch rejection).
    const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
    const causeCode = cause && typeof cause === 'object' && 'code' in cause ? (cause as { code?: unknown }).code : undefined;
    if (causeCode === 'ECONNREFUSED') {
      console.error(chalk.red('Error: Dashboard not running'));
      console.error(chalk.dim('Start the dashboard with: pan up'));
      return exitCli(1);
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${msg}`));
    return exitCli(1);
  }
}
