/**
 * The commits one conversation made (PAN-5288 WI-2, PRD §6.5).
 *
 * Two sources, merged by full sha:
 * - Trailer commits: `Overdeck-Conversation: <session name>` (PAN-5281),
 *   matched exactly on `conv.tmuxSession`, never the bare name (PAN-5284 D-16).
 * - Tool-output commits: git's `[<branch> <sha>] <subject>` line in the result
 *   of the conversation's own `git commit` shell call. A candidate is kept only
 *   when it still resolves and is reachable from `HEAD`, so an amended commit's
 *   old object (which resolves until `git gc`) is dropped (A-D7).
 *
 * Without an upstream, a commit counts as pushed when any remote-tracking ref
 * contains it (`git rev-list HEAD --not --remotes`); with no remote every
 * commit is local. `hasUpstream` means the shas set is meaningful. Async
 * `execFile` only: the dashboard server calls this.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ChangeCommit, WorkLogEntry } from '@overdeck/contracts';

import { listAttributedCommits, listCommitFilesAt } from '../git/attributed-commits.js';
import type { ConversationDiffParseResult } from './conversation-diffs.js';

const execFileAsync = promisify(execFile);

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

function timeOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * The turn containing `at` (A-D6): the assistant messages between the last
 * user message at or before `at` and the next user message. Returns the last
 * of those that is in `editTurnIds` (when given and present), else the last
 * of them, else `undefined`.
 */
export function turnIdAt(
  messages: ConversationDiffParseResult['messages'],
  at: string,
  editTurnIds?: ReadonlySet<string>,
): string | undefined {
  const sorted = [...messages].sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));
  const atMs = timeOf(at);
  let start = -1;
  for (let i = 0; i < sorted.length; i++) {
    const message = sorted[i]!;
    if (message.role === 'user' && timeOf(message.createdAt) <= atMs) start = i;
  }
  let end = sorted.length;
  for (let i = start + 1; i < sorted.length; i++) {
    if (sorted[i]!.role === 'user') {
      end = i;
      break;
    }
  }
  const candidates = sorted.slice(start + 1, end).filter((m) => m.role === 'assistant');
  if (editTurnIds) {
    const edited = candidates.filter((m) => editTurnIds.has(m.id));
    if (edited.length > 0) return edited[edited.length - 1]!.id;
  }
  return candidates.length > 0 ? candidates[candidates.length - 1]!.id : undefined;
}

const GIT_COMMIT_COMMAND = /\bgit\b[\s\S]*\bcommit\b/;
const COMMIT_RESULT_LINE = /^\[(?<branch>[^\s\]]+)(?: \(root-commit\))? (?<sha>[0-9a-f]{7,40})\] (?<subject>.+)$/gm;

/** Short shas printed by `git commit` in the conversation's own shell tool results (A-D7). */
export function toolOutputCommitCandidates(workLog: ReadonlyArray<WorkLogEntry>): Array<{ shortSha: string; at: string }> {
  const candidates: Array<{ shortSha: string; at: string }> = [];
  for (const entry of workLog) {
    const inputCommand = entry.toolInput?.['command'];
    const command = typeof inputCommand === 'string' ? inputCommand : entry.command;
    if (!command || !GIT_COMMIT_COMMAND.test(command) || !entry.result) continue;
    for (const match of entry.result.matchAll(COMMIT_RESULT_LINE)) {
      const sha = match.groups?.['sha'];
      if (sha) candidates.push({ shortSha: sha, at: entry.createdAt });
    }
  }
  return candidates;
}

/**
 * Commits on `HEAD` not yet on the upstream. A detached `HEAD` has no
 * upstream, so without one this falls back to commits not reachable from any
 * remote-tracking ref; no remote at all (or any failure) ⇒ `hasUpstream: false`.
 */
export async function listLocalShas(repoRoot: string): Promise<{ shas: Set<string>; hasUpstream: boolean }> {
  try {
    const out = await git(repoRoot, ['rev-list', '@{u}..HEAD']);
    return { shas: new Set(out.split('\n').map((l) => l.trim()).filter((l) => l !== '')), hasUpstream: true };
  } catch {
    try {
      const remotes = (await git(repoRoot, ['remote'])).split('\n').filter((l) => l.trim() !== '');
      if (remotes.length === 0) return { shas: new Set(), hasUpstream: false };
      const out = await git(repoRoot, ['rev-list', 'HEAD', '--not', '--remotes']);
      return { shas: new Set(out.split('\n').map((l) => l.trim()).filter((l) => l !== '')), hasUpstream: true };
    } catch {
      return { shas: new Set(), hasUpstream: false };
    }
  }
}

/** The full sha of `shortSha` when it resolves to a commit reachable from `HEAD`, else null. */
async function reachableCommit(repoRoot: string, shortSha: string): Promise<string | null> {
  let full: string;
  try {
    full = (await git(repoRoot, ['rev-parse', '--verify', '--quiet', `${shortSha}^{commit}`])).trim();
  } catch {
    return null;
  }
  if (full === '') return null;
  try {
    await git(repoRoot, ['merge-base', '--is-ancestor', full, 'HEAD']);
    return full;
  } catch {
    return null;
  }
}

/**
 * Every commit this conversation made, newest first (A-D8), with `pushed`
 * and `turnId`. `toolOutputOnly` holds the full shas found only by tool output.
 */
export async function listConversationCommits(input: {
  repoRoot: string;
  sessionName: string;
  since: string;
  parsed: ConversationDiffParseResult | null;
}): Promise<{ commits: ChangeCommit[]; toolOutputOnly: Set<string> }> {
  const { repoRoot, sessionName, since, parsed } = input;
  const trailerCommits = await listAttributedCommits({
    repoPath: repoRoot,
    key: 'Overdeck-Conversation',
    value: sessionName,
    since,
  });

  type Found = { sha: string; subject: string; authoredAt: string; files: ChangeCommit['files']; trailer: boolean; toolAt?: string };
  const found = new Map<string, Found>();
  for (const commit of trailerCommits) {
    found.set(commit.sha, { ...commit, trailer: true });
  }

  for (const candidate of toolOutputCommitCandidates(parsed?.workLog ?? [])) {
    const full = await reachableCommit(repoRoot, candidate.shortSha);
    if (!full) continue;
    const existing = found.get(full);
    if (existing) {
      existing.toolAt ??= candidate.at;
      continue;
    }
    const [sha = full, subject = '', authoredAt = ''] = (await git(repoRoot, ['show', '-s', '--format=%H%x1f%s%x1f%aI', full]))
      .trim()
      .split('\x1f');
    found.set(full, {
      sha,
      subject,
      authoredAt,
      files: await listCommitFilesAt(repoRoot, full),
      trailer: false,
      toolAt: candidate.at,
    });
  }

  const local = found.size > 0 ? await listLocalShas(repoRoot) : { shas: new Set<string>(), hasUpstream: false };
  const editTurnIds = parsed?.fileEditsByAssistantId ? new Set(parsed.fileEditsByAssistantId.keys()) : undefined;
  const toolOutputOnly = new Set<string>();
  const commits: ChangeCommit[] = [];
  for (const commit of found.values()) {
    if (!commit.trailer) toolOutputOnly.add(commit.sha);
    const turnId = parsed ? turnIdAt(parsed.messages, commit.toolAt ?? commit.authoredAt, editTurnIds) : undefined;
    commits.push({
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 7),
      subject: commit.subject,
      authoredAt: commit.authoredAt,
      pushed: local.hasUpstream && !local.shas.has(commit.sha),
      attribution: commit.trailer ? 'trailer' : 'tool-output',
      files: commit.files,
      ...(turnId ? { turnId } : {}),
    });
  }
  commits.sort((a, b) => timeOf(b.authoredAt) - timeOf(a.authoredAt));
  return { commits, toolOutputOnly };
}
