/**
 * Explicit PR link commands for a conversation (PAN-3822): list, link, unlink.
 *
 * The dashboard routes and `pan conv link-pr` / `unlink-pr` / `prs` share these
 * so the ref parsing, the foreign-repository refusal, and the event emission
 * live in one place. A ref is accepted only when its repository is configured
 * for the conversation's project: `github_repo` / `gitlab_repo`, a URL-shaped
 * `workspace.repos[].remote`, or the `origin` remote of the project checkout or
 * of the conversation's cwd. Refused refs are never persisted.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  isConfiguredPullRequestRepo,
  parsePullRequestRef,
  repoFromRemoteUrl,
  resolveEffectivePullRequest,
  type ConversationPullRequests,
  type ParsedPullRequestRef,
  type PullRequestRepo,
  type PullRequestLink,
  type PullRequestLinkedConversation,
  type PullRequestLinkListing,
  type PullRequestState,
} from '@overdeck/contracts';

import { findProjectByPath, getProjectSync, listProjectsSync, type ProjectConfig } from '../projects.js';
import {
  emitConversationPullRequestsChanged,
  linkConversationPullRequest,
  listAllPullRequestLinks,
  listConversationPullRequests,
  listConversationsLinkedToPullRequest,
  unlinkConversationPullRequest,
  type ExplicitPullRequestLinkSource,
} from './conversation-pull-requests.js';
import { getConversationByName } from './conversations.js';

const execFileAsync = promisify(execFile);

export type PullRequestCommandErrorCode = 'not_found' | 'invalid_ref' | 'foreign_repository' | 'not_linked' | 'invalid_filter';

export type PullRequestCommandResult<T> =
  | { readonly ok: true; readonly status: number; readonly body: T }
  | { readonly ok: false; readonly status: number; readonly body: { error: string; code: PullRequestCommandErrorCode } };

export interface PullRequestCommandDeps {
  /** `git remote get-url origin` for a directory; null when unreadable. */
  readonly readOriginRemote?: (dir: string) => Promise<string | null>;
  /** Started (not awaited) after a successful explicit link to fill its snapshot. */
  readonly refreshLink?: (link: PullRequestLink) => Promise<void>;
}

async function defaultReadOriginRemote(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function fail<T>(status: number, code: PullRequestCommandErrorCode, error: string): PullRequestCommandResult<T> {
  return { ok: false, status, body: { error, code } };
}

function conversationProject(conv: { cwd: string; projectKey: string | null }): ProjectConfig | null {
  if (conv.projectKey) {
    const project = getProjectSync(conv.projectKey);
    if (project) return project;
  }
  return findProjectByPath(conv.cwd);
}

/**
 * Repositories PRs may be linked from for this conversation, most specific
 * first; the first one is the default for `#42`.
 */
export async function resolveConversationPullRequestRepos(
  conv: { cwd: string; projectKey: string | null },
  deps: PullRequestCommandDeps = {},
): Promise<{ repos: PullRequestRepo[]; project: ProjectConfig | null }> {
  const readOrigin = deps.readOriginRemote ?? defaultReadOriginRemote;
  const project = conversationProject(conv);
  const [projectOrigin, cwdOrigin] = await Promise.all([
    project?.path ? readOrigin(project.path) : Promise.resolve(null),
    readOrigin(conv.cwd),
  ]);
  const originRepos = [projectOrigin, cwdOrigin].map(repoFromRemoteUrl).filter((repo) => repo !== null);
  const gitlabHost = originRepos.find((repo) => repo.forge === 'gitlab')?.host ?? 'gitlab.com';
  const githubHost = originRepos.find((repo) => repo.forge === 'github')?.host ?? 'github.com';

  const repos: PullRequestRepo[] = [];
  if (project?.github_repo) repos.push({ host: githubHost, repository: project.github_repo.toLowerCase(), forge: 'github' });
  if (project?.gitlab_repo) repos.push({ host: gitlabHost, repository: project.gitlab_repo.toLowerCase(), forge: 'gitlab' });
  repos.push(...originRepos);
  for (const repo of project?.workspace?.repos ?? []) {
    const remoteRepo = repoFromRemoteUrl(repo.remote);
    if (remoteRepo) repos.push(remoteRepo);
  }
  const seen = new Set<string>();
  return {
    project,
    repos: repos.filter((repo) => {
      const id = `${repo.host}/${repo.repository}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  };
}

export function getConversationPullRequests(name: string): PullRequestCommandResult<ConversationPullRequests> {
  if (!getConversationByName(name)) return fail(404, 'not_found', 'Conversation not found');
  const links = listConversationPullRequests(name);
  return { ok: true, status: 200, body: { links, effective: resolveEffectivePullRequest(links) } };
}

async function parseForConversation(
  name: string,
  ref: string,
  deps: PullRequestCommandDeps,
): Promise<PullRequestCommandResult<ParsedPullRequestRef>> {
  const conv = getConversationByName(name);
  if (!conv) return fail(404, 'not_found', 'Conversation not found');
  const { repos } = await resolveConversationPullRequestRepos(conv, deps);
  const parsed = parsePullRequestRef(ref, repos[0] ?? null);
  if (!parsed) {
    return fail(400, 'invalid_ref', repos.length === 0 && /^[\w./-]*[#!]\d+$/.test(ref.trim())
      ? `Cannot resolve "${ref}": the conversation has no configured repository; paste the full pull request URL`
      : `Not a pull request reference: "${ref}" (expected a PR/MR URL, #42, or owner/repo#42)`);
  }
  if (!isConfiguredPullRequestRepo(parsed, repos)) {
    const known = repos.map((repo) => `${repo.host}/${repo.repository}`).join(', ') || 'none';
    return fail(400, 'foreign_repository',
      `${parsed.host}/${parsed.repository} is not a repository of this conversation's project (configured: ${known})`);
  }
  return { ok: true, status: 200, body: parsed };
}

export async function linkPullRequestToConversation(
  name: string,
  ref: string,
  source: ExplicitPullRequestLinkSource,
  deps: PullRequestCommandDeps = {},
): Promise<PullRequestCommandResult<PullRequestLink>> {
  const parsed = await parseForConversation(name, ref, deps);
  if (!parsed.ok) return parsed;
  const link = linkConversationPullRequest(name, parsed.body, source);
  if (!link) return fail(404, 'not_found', 'Conversation not found');
  emitConversationPullRequestsChanged(name);
  if (deps.refreshLink) {
    // Fill the snapshot in the background; the event fires again when it lands.
    void deps.refreshLink(link)
      .then(() => emitConversationPullRequestsChanged(name))
      .catch((error: unknown) => console.warn('[pr-link] snapshot refresh after link failed:', error));
  }
  return { ok: true, status: 201, body: link };
}

/**
 * Unlink by ref. No foreign-repository check: any stored link can be removed,
 * and `#42` resolves against the same default repository as linking.
 */
export async function unlinkPullRequestFromConversation(
  name: string,
  ref: string,
  deps: PullRequestCommandDeps = {},
): Promise<PullRequestCommandResult<{ unlinked: true; link: PullRequestLink }>> {
  const conv = getConversationByName(name);
  if (!conv) return fail(404, 'not_found', 'Conversation not found');
  const { repos } = await resolveConversationPullRequestRepos(conv, deps);
  const parsed = parsePullRequestRef(ref, repos[0] ?? null);
  if (!parsed) return fail(400, 'invalid_ref', `Not a pull request reference: "${ref}"`);
  const existing = listConversationPullRequests(name).find(
    (link) => link.host === parsed.host && link.repository === parsed.repository && link.number === parsed.number,
  );
  if (!existing || !unlinkConversationPullRequest(name, parsed).unlinked) {
    return fail(404, 'not_linked', `${parsed.repository}#${parsed.number} is not linked to this conversation`);
  }
  emitConversationPullRequestsChanged(name);
  return { ok: true, status: 200, body: { unlinked: true, link: existing } };
}

/**
 * Force a snapshot refresh of every live, not-yet-merged link on a
 * conversation (merged snapshots are final), then return the fresh view.
 * Emits one event per conversation whose links changed.
 */
export async function syncConversationPullRequests(
  name: string,
  refresh: (link: PullRequestLink) => Promise<readonly string[]>,
): Promise<PullRequestCommandResult<ConversationPullRequests>> {
  if (!getConversationByName(name)) return fail(404, 'not_found', 'Conversation not found');
  const due = listConversationPullRequests(name).filter((link) => link.dismissedAt === null && link.snapshot?.state !== 'merged');
  const changed = new Set<string>();
  for (const link of due) {
    try {
      for (const changedName of await refresh(link)) changed.add(changedName);
    } catch (error) {
      console.warn(`[pr-link] refresh of ${link.repository}#${link.number} failed:`, error);
    }
  }
  for (const changedName of changed) emitConversationPullRequestsChanged(changedName);
  return getConversationPullRequests(name);
}

/** Reverse index by PR URL: the conversations with a live link to it. */
export function getPullRequestConversations(url: string): PullRequestCommandResult<{
  pullRequest: ParsedPullRequestRef;
  conversations: PullRequestLinkedConversation[];
}> {
  const ref = parsePullRequestRef(url);
  if (!ref) return fail(400, 'invalid_ref', `Not a pull request URL: "${url}"`);
  return { ok: true, status: 200, body: { pullRequest: ref, conversations: listConversationsLinkedToPullRequest(ref) } };
}

const PULL_REQUEST_STATES: readonly string[] = ['open', 'merged', 'closed'];

function effectiveProjectKey(
  conv: { cwd: string; projectKey: string | null },
  projects: ReadonlyArray<{ key: string; config: ProjectConfig }>,
): string | null {
  if (conv.projectKey) return conv.projectKey;
  return projects.find(({ config }) => config.path && (conv.cwd === config.path || conv.cwd.startsWith(`${config.path}/`)))?.key ?? null;
}

/**
 * Every live link across conversations for the Pull requests list, optionally
 * filtered by snapshot state and by the conversation's effective project.
 */
export function listPullRequestLinks(filter: { state?: string | null; project?: string | null } = {}): PullRequestCommandResult<{
  links: PullRequestLinkListing[];
}> {
  const state = filter.state || undefined;
  if (state && !PULL_REQUEST_STATES.includes(state)) {
    return fail(400, 'invalid_filter', `Unknown state "${state}" (expected open, merged, or closed)`);
  }
  const projects = listProjectsSync();
  const links = listAllPullRequestLinks({ state: state as PullRequestState | undefined })
    .map(({ conversationCwd, conversationProjectKey, ...link }) => ({
      ...link,
      projectKey: effectiveProjectKey({ cwd: conversationCwd, projectKey: conversationProjectKey }, projects),
    }))
    .filter((link) => !filter.project || link.projectKey === filter.project);
  return { ok: true, status: 200, body: { links } };
}
