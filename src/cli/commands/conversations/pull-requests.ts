/**
 * pan conversations link-pr / unlink-pr / prs (PAN-3822) — the agent-facing
 * door for pull requests linked to a conversation — plus auto-settle-on-merge
 * and auto-settle (PAN-4653), the global setting and per-conversation override.
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
import {
  isConversationsAutoSettleOnMerge,
  setConversationsAutoSettleOnMerge,
} from '../../../lib/overdeck/control-settings.js';
import {
  applyTriageUpdate,
  AUTO_SETTLE_OVERRIDES,
  getConversationTriage,
  type AutoSettleOverride,
} from '../../../lib/overdeck/conversation-triage-store.js';
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

/** `pan conv auto-settle-on-merge [on|off]` — read or set `conversations.auto_settle_on_merge` (default on). */
export async function autoSettleOnMergeAction(value?: string): Promise<void> {
  if (value === undefined) {
    console.log(isConversationsAutoSettleOnMerge() ? 'on' : 'off');
    return;
  }
  if (value !== 'on' && value !== 'off') {
    console.error(chalk.red(`Error: expected "on" or "off", got "${value}"`));
    return exitCli(1);
  }
  setConversationsAutoSettleOnMerge(value === 'on');
  console.log(chalk.green(value === 'on'
    ? '✓ Conversations are settled once all their linked PRs are merged or closed (sessions keep running)'
    : '✓ Auto-settle on merge is off'));
}

/** `pan conv auto-settle <query> [on|off|inherit]` — read or set one conversation's override. */
export async function autoSettleOverrideAction(query: string, value?: string): Promise<void> {
  const name = await resolveOrExit(query);
  if (value === undefined) {
    const override = getConversationTriage(name)?.autoSettleOverride ?? 'inherit';
    console.log(override === 'inherit' ? `inherit (global: ${isConversationsAutoSettleOnMerge() ? 'on' : 'off'})` : override);
    return;
  }
  if (!(AUTO_SETTLE_OVERRIDES as readonly string[]).includes(value)) {
    console.error(chalk.red(`Error: expected "on", "off", or "inherit", got "${value}"`));
    return exitCli(1);
  }
  const override = value as AutoSettleOverride;
  const result = await viaDashboard<{ conversations: unknown[]; notFound: string[]; rejected: unknown[] }>(
    '/api/conversations/triage',
    { method: 'POST', body: JSON.stringify({ updates: [{ name, autoSettleOverride: override }] }) },
    () => applyTriageUpdate({ name, autoSettleOverride: override })
      ? { ok: true, status: 200, body: { conversations: [], notFound: [], rejected: [] } }
      : { ok: false, status: 404, body: { error: 'Conversation not found', code: 'not_found' } },
  );
  if (!result.ok) return failWith(result.status, result.body as { error?: string });
  const body = result.body as { notFound: string[]; rejected: unknown[] };
  if (body.notFound.length > 0 || body.rejected.length > 0) {
    console.error(chalk.red(`Error: auto-settle override not applied to ${name} (not found or a read-only vault copy)`));
    return exitCli(1);
  }
  console.log(chalk.green(`✓ Auto-settle on merge for ${name}: ${override}`));
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
