/**
 * Pull-request references (PAN-3822): parse what an operator or agent types
 * (a PR/MR URL, `#42`, `owner/repo#42`) into a PR key, rebuild the canonical
 * URL from a key, and decide whether a ref belongs to a repository configured
 * for the conversation's project.
 *
 * The URL shape decides the forge, not the host, so self-hosted GitLab and
 * GitHub Enterprise both parse. Host and repository are lower-cased; the stored
 * URL is always rebuilt from the key, never the pasted text.
 */

import type { PullRequestKey } from '@overdeck/contracts';

export type PullRequestForge = 'github' | 'gitlab';

/** A repository PRs can be linked from. */
export interface PullRequestRepo {
  readonly host: string;
  readonly repository: string;
  readonly forge: PullRequestForge;
}

export interface ParsedPullRequestRef extends PullRequestKey {
  readonly url: string;
  readonly forge: PullRequestForge;
}

const SCHEME = String.raw`(?:https?:\/\/)?`;
const HOST = String.raw`([a-z0-9.-]+(?::\d+)?)`;
const TAIL = String.raw`(?:\/[^?#]*)?(?:[?#].*)?$`;
const GITLAB_MR = new RegExp(String.raw`^${SCHEME}${HOST}\/((?:[\w.-]+\/)+[\w.-]+)\/-\/merge_requests\/(\d+)${TAIL}`, 'i');
const GITHUB_PR = new RegExp(String.raw`^${SCHEME}${HOST}\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)${TAIL}`, 'i');
const GITLAB_MR_LEGACY = new RegExp(String.raw`^${SCHEME}${HOST}\/((?:[\w.-]+\/)+[\w.-]+)\/merge_requests\/(\d+)${TAIL}`, 'i');
const SHORT_REF = /^(?:((?:[\w.-]+\/)+[\w.-]+))?[#!](\d+)$/;

export function canonicalPullRequestUrl(key: PullRequestKey, forge: PullRequestForge): string {
  return forge === 'gitlab'
    ? `https://${key.host}/${key.repository}/-/merge_requests/${key.number}`
    : `https://${key.host}/${key.repository}/pull/${key.number}`;
}

function build(host: string, repository: string, number: number, forge: PullRequestForge): ParsedPullRequestRef | null {
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  const key = { host: host.toLowerCase(), repository: repository.toLowerCase().replace(/\.git$/, ''), number };
  return { ...key, forge, url: canonicalPullRequestUrl(key, forge) };
}

/**
 * Accepts a full PR/MR URL, `#42`, or `owner/repo#42` (`!42` for GitLab MRs).
 * The short forms need `defaultRepo` for host and forge (`#42` for the
 * repository too) and return null without it. Anything else returns null.
 */
export function parsePullRequestRef(input: string, defaultRepo?: PullRequestRepo | null): ParsedPullRequestRef | null {
  const text = input.trim();
  if (!text) return null;
  for (const [pattern, forge] of [
    [GITLAB_MR, 'gitlab'],
    [GITHUB_PR, 'github'],
    [GITLAB_MR_LEGACY, 'gitlab'],
  ] as const) {
    const match = pattern.exec(text);
    if (match) return build(match[1]!, match[2]!, Number(match[3]), forge);
  }
  const short = SHORT_REF.exec(text);
  if (!short || !defaultRepo) return null;
  return build(defaultRepo.host, short[1] ?? defaultRepo.repository, Number(short[2]), defaultRepo.forge);
}

/**
 * The repository behind a git remote URL (https, ssh://, or scp-style), or null
 * when the host names neither GitHub nor GitLab.
 */
export function repoFromRemoteUrl(remote: string | null | undefined): PullRequestRepo | null {
  if (!remote) return null;
  const text = remote.trim();
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(text)
    ?? /^(?:[^@/]+@)?([^/:]+):(.+?)(?:\.git)?\/?$/i.exec(text);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  const forge: PullRequestForge | null = host.includes('gitlab') ? 'gitlab' : host.includes('github') ? 'github' : null;
  if (!forge) return null;
  return { host, repository: match[2]!.toLowerCase(), forge };
}

/** True when the ref's host and repository match one of the configured repos. */
export function isConfiguredPullRequestRepo(ref: PullRequestKey, repos: readonly PullRequestRepo[]): boolean {
  return repos.some((repo) => repo.host === ref.host && repo.repository === ref.repository);
}
