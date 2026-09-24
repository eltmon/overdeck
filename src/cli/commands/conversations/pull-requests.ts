/**
 * pan conversations link-pr / unlink-pr / prs (PAN-3822) — the agent-facing
 * door for pull requests linked to a conversation.
 *
 * <query> resolves like `pan conv move`: exact name, then a unique fuzzy title
 * match. <ref> is a PR/MR URL, `#42`, or `owner/repo#42`. The verbs call the
 * dashboard routes so connected clients refresh at once; with the dashboard
 * down they write through the same command module directly.
 *
 * Exit codes: 0 ok; 1 invalid ref, foreign repository, not linked, or error;
 * 2 conversation not found.
 */

import chalk from 'chalk';

import type { ConversationPullRequests, PullRequestLink } from '@overdeck/contracts';

import { exitCli } from '../../exit.js';
import { getDashboardApiUrl } from '../../../lib/config.js';
import {
  getConversationPullRequests,
  linkPullRequestToConversation,
  unlinkPullRequestFromConversation,
  type PullRequestCommandResult,
} from '../../../lib/overdeck/conversation-pull-request-commands.js';
import { resolveConversation } from './move.js';

type LinkSource = 'agent' | 'manual';

function isConnectionRefused(error: unknown): boolean {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  return Boolean(cause && typeof cause === 'object' && 'code' in cause && (cause as { code?: unknown }).code === 'ECONNREFUSED');
}

/** Dashboard route first; the in-process command when the dashboard is down. */
async function viaDashboard<T>(
  path: string,
  init: RequestInit,
  offline: () => Promise<PullRequestCommandResult<T>> | PullRequestCommandResult<T>,
): Promise<{ ok: boolean; status: number; body: T | { error: string; code?: string } }> {
  try {
    const response = await fetch(`${getDashboardApiUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await response.json() as T | { error: string; code?: string };
    return { ok: response.ok, status: response.status, body };
  } catch (error: unknown) {
    if (!isConnectionRefused(error)) throw error;
    return offline();
  }
}

function resolveOrExit(query: string): Promise<string> | string {
  const { conversation, candidates } = resolveConversation(query);
  if (conversation) return conversation.name;
  if (candidates.length === 0) {
    console.error(chalk.red(`No conversation found matching "${query}"`));
  } else {
    console.error(chalk.red(`Ambiguous match for "${query}" — ${candidates.length} candidates:`));
    for (const c of candidates) console.error(chalk.dim(`  ${c.name}  ${c.title ?? '(untitled)'}`));
  }
  return exitCli(2);
}

async function failWith(status: number, body: { error?: string }): Promise<never> {
  console.error(chalk.red(`Error: ${body.error ?? 'request failed'}`));
  return exitCli(status === 404 && !/not linked/.test(body.error ?? '') ? 2 : 1);
}

function describeLink(link: PullRequestLink): string {
  const state = link.snapshot ? link.snapshot.state + (link.snapshot.isDraft ? ', draft' : '') : 'not synced';
  const title = link.snapshot?.title ? `  ${link.snapshot.title}` : '';
  const dismissed = link.dismissedAt ? ' (unlinked)' : '';
  return `${link.repository}#${link.number}  [${link.source}, ${state}]${dismissed}${title}\n    ${link.url}`;
}

export function defaultLinkSource(): LinkSource {
  return process.env.OVERDECK_AGENT_ID ? 'agent' : 'manual';
}

export async function linkPrAction(query: string, ref: string, opts: { source?: string } = {}): Promise<void> {
  const name = await resolveOrExit(query);
  const source: LinkSource = opts.source === 'agent' || opts.source === 'manual' ? opts.source : defaultLinkSource();
  const result = await viaDashboard<PullRequestLink>(
    `/api/conversations/${encodeURIComponent(name)}/pull-requests`,
    { method: 'POST', body: JSON.stringify({ ref, source }) },
    () => linkPullRequestToConversation(name, ref, source),
  );
  if (!result.ok) return failWith(result.status, result.body as { error?: string });
  const link = result.body as PullRequestLink;
  console.log(chalk.green(`✓ Linked ${link.repository}#${link.number} to ${name} (${link.source})`));
}

export async function unlinkPrAction(query: string, ref: string): Promise<void> {
  const name = await resolveOrExit(query);
  const result = await viaDashboard<{ unlinked: true; link: PullRequestLink }>(
    `/api/conversations/${encodeURIComponent(name)}/pull-requests?ref=${encodeURIComponent(ref)}`,
    { method: 'DELETE' },
    () => unlinkPullRequestFromConversation(name, ref),
  );
  if (!result.ok) return failWith(result.status, result.body as { error?: string });
  const { link } = result.body as { link: PullRequestLink };
  console.log(chalk.green(`✓ Unlinked ${link.repository}#${link.number} from ${name}`));
}

export async function prsAction(query: string, opts: { json?: boolean } = {}): Promise<void> {
  const name = await resolveOrExit(query);
  const result = getConversationPullRequests(name);
  if (!result.ok) return failWith(result.status, result.body);
  const view: ConversationPullRequests = result.body;
  if (opts.json) {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  if (view.links.length === 0) {
    console.log(chalk.dim(`No pull requests linked to ${name}`));
    return;
  }
  for (const link of view.links) {
    const marker = view.effective && link.host === view.effective.host && link.repository === view.effective.repository
      && link.number === view.effective.number ? '*' : ' ';
    console.log(`${marker} ${describeLink(link)}`);
  }
}
