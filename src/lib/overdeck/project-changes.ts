/**
 * Recent commits on a project's default branch and who made them
 * (PAN-5288 WI-4, PRD §6.7). Serves `GET /api/projects/:projectKey/changes`,
 * and scope `main` of the conversation changes API reuses
 * {@link listBranchCommits} and {@link byForAttribution}.
 *
 * Attribution precedence (A-D11): the final-paragraph `Overdeck-Conversation`
 * trailer, then `Overdeck-Agent`, then the same keys anywhere in the body —
 * GitHub squash merges move each sub-commit's trailers into the body and
 * leave only `Co-authored-by:` lines in the final paragraph.
 *
 * Async `execFile` with argument arrays only: the dashboard server calls this.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ProjectChanges, ProjectCommit } from '@overdeck/contracts';

import { resolveDefaultBranchForRepo } from '../project-repos.js';
import { getProjectSync } from '../projects.js';
import { getConversationByTmuxSession } from './conversations.js';

const execFileAsync = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SINCE_MS = 90 * DAY_MS;
const DEFAULT_SINCE_MS = 7 * DAY_MS;
const MAX_PROJECT_COMMITS = 500;

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, '-c', 'log.showSignature=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

export type CommitAttribution = { source: 'conversation' | 'agent'; value: string } | null;

const BODY_CONVERSATION = /^\s*Overdeck-Conversation:\s*(\S+)\s*$/m;
const BODY_AGENT = /^\s*Overdeck-Agent:\s*(\S+)\s*$/m;

/** Who made a commit, by A-D11 steps 1-5. */
export function attributeCommit(input: {
  conversationTrailers: string[];
  agentTrailers: string[];
  body: string;
}): CommitAttribution {
  const conversation = input.conversationTrailers.find((v) => v.trim() !== '')?.trim();
  if (conversation) return { source: 'conversation', value: conversation };
  const agent = input.agentTrailers.find((v) => v.trim() !== '')?.trim();
  if (agent) return { source: 'agent', value: agent };
  const bodyConversation = BODY_CONVERSATION.exec(input.body)?.[1];
  if (bodyConversation) return { source: 'conversation', value: bodyConversation };
  const bodyAgent = BODY_AGENT.exec(input.body)?.[1];
  if (bodyAgent) return { source: 'agent', value: bodyAgent };
  return null;
}

/** The `by` of a commit from its attribution (A-D11 mapping). */
export function byForAttribution(attribution: CommitAttribution): ProjectCommit['by'] {
  if (!attribution) return { kind: 'unattributed' };
  const { source, value } = attribution;
  if (source === 'conversation') {
    const conv = getConversationByTmuxSession(value);
    return { kind: 'conversation', id: conv?.name ?? value.replace(/^conv-/, ''), title: conv?.title ?? conv?.name ?? value };
  }
  const issue = /[a-z][a-z0-9]*-\d+/i.exec(value)?.[0];
  return { kind: 'agent', id: value, title: issue ? issue.toUpperCase() : value };
}

/** First-parent commits on `ref` since `sinceIso`, newest first, at most `maxCount`, with their attribution. */
export async function listBranchCommits(
  repoPath: string,
  ref: string,
  sinceIso: string,
  maxCount: number,
): Promise<Array<{ sha: string; subject: string; authoredAt: string; attribution: CommitAttribution }>> {
  const format = [
    '%H', '%s', '%aI',
    '%(trailers:key=Overdeck-Conversation,valueonly,separator=%x1d)',
    '%(trailers:key=Overdeck-Agent,valueonly,separator=%x1d)',
    '%B',
  ].join('%x1f') + '%x1e';
  const out = await git(repoPath, [
    'log', '--first-parent', '--no-color', `--max-count=${maxCount}`, `--since=${sinceIso}`, `--format=${format}`, ref, '--',
  ]);
  const values = (raw: string): string[] => raw.split('\x1d').map((v) => v.trim()).filter((v) => v !== '');
  return out
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [sha = '', subject = '', authoredAt = '', conversations = '', agents = '', ...body] = record.split('\x1f');
      return {
        sha,
        subject,
        authoredAt,
        attribution: attributeCommit({
          conversationTrailers: values(conversations),
          agentTrailers: values(agents),
          body: body.join('\x1f'),
        }),
      };
    });
}

/** The `since` query value (A-D14): `<n>d`, `<n>h`, any `Date.parse` value, or null (7 days); at most 90 days back. */
export function parseSince(value: string | null, now: number): { ok: true; iso: string } | { ok: false } {
  let start: number;
  if (value === null || value === '') {
    start = now - DEFAULT_SINCE_MS;
  } else {
    const relative = /^(\d{1,4})([dh])$/.exec(value);
    if (relative) {
      start = now - Number(relative[1]) * (relative[2] === 'd' ? DAY_MS : 60 * 60 * 1000);
    } else {
      start = Date.parse(value);
      if (!Number.isFinite(start)) return { ok: false };
    }
  }
  if (now - start > MAX_SINCE_MS) return { ok: false };
  return { ok: true, iso: new Date(start).toISOString() };
}

async function verifiesAsCommit(repoPath: string, ref: string): Promise<boolean> {
  try {
    return (await git(repoPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() !== '';
  } catch {
    return false;
  }
}

/** Recent commits on the project's default branch (A-D13); unknown key ⇒ 404. */
export async function getProjectChanges(
  projectKey: string,
  opts: { sinceIso: string },
): Promise<{ status: 200; body: ProjectChanges } | { status: 404; body: { error: string } }> {
  const project = getProjectSync(projectKey);
  if (!project) return { status: 404, body: { error: 'Project not found' } };

  const branch = resolveDefaultBranchForRepo(project.path, projectKey);
  const ref = (await verifiesAsCommit(project.path, `origin/${branch}`))
    ? `origin/${branch}`
    : (await verifiesAsCommit(project.path, branch)) ? branch : null;
  if (!ref) return { status: 200, body: { projectKey, branch, commits: [] } };

  const commits = await listBranchCommits(project.path, ref, opts.sinceIso, MAX_PROJECT_COMMITS);
  return {
    status: 200,
    body: {
      projectKey,
      branch,
      commits: commits.map((commit) => ({
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        subject: commit.subject,
        authoredAt: commit.authoredAt,
        by: byForAttribution(commit.attribution),
      })),
    },
  };
}
