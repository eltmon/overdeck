/**
 * List the commits an Overdeck conversation or agent made in a repository.
 *
 * Since PAN-5281 the git shims on agent and conversation PATHs add one
 * trailer to every `git commit`: `Overdeck-Agent: <agent id>` from the agent
 * shim (`buildGitGuardLines`) and `Overdeck-Conversation: <session name>`
 * from the conversation shim (`buildConversationShimLines`), both in
 * `src/lib/launcher-git-guard.ts`. `listAttributedCommits` reads those
 * trailers back from the commits reachable from `HEAD`.
 *
 * Merge commits are excluded: a merge's diff against its first parent shows
 * everything the merge brought in, not what the session wrote.
 *
 * Async process execution only: the dashboard server calls this, and a
 * synchronous child process would block its event loop.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AttributionKey = 'Overdeck-Conversation' | 'Overdeck-Agent';

export interface AttributedCommitFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  additions: number;
  deletions: number;
}

export interface AttributedCommit {
  sha: string;
  subject: string;
  authoredAt: string;
  files: AttributedCommitFile[];
}

const DEFAULT_MAX_COUNT = 200;

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function toStatus(raw: string): AttributedCommitFile['status'] {
  if (raw.startsWith('R')) return 'R';
  if (raw === 'A' || raw === 'D') return raw;
  return 'M';
}

function toCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Non-merge commits reachable from `HEAD` whose trailer `key` has the value
 * `value`, newest first, at most `maxCount` (default 200) matching commits.
 * A repository without commits and an empty `value` return `[]`; a path that
 * is not a git repository rejects.
 */
export async function listAttributedCommits(opts: {
  repoPath: string;
  key: AttributionKey;
  value: string;
  since?: string;
  maxCount?: number;
}): Promise<AttributedCommit[]> {
  const { repoPath, key, value } = opts;
  if (value.trim() === '') return [];

  const git = async (args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, '-c', 'log.showSignature=false', ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  };

  try {
    await git(['rev-parse', '--verify', '--quiet', 'HEAD']);
  } catch (error) {
    // No HEAD: an empty repository returns []; anything that is not a repository rejects.
    await git(['rev-parse', '--git-dir']).catch(() => {
      throw error;
    });
    return [];
  }

  // Filter in git, cap in JS: `--max-count` would apply before the trailer
  // check below, so a body-only match could take the only slot. Git's trailer
  // parser matches keys case-insensitively and allows whitespace before the
  // colon, so the prefilter does too (`-i`); the exact value check stays below.
  const grep = `^${escapeRegExp(key)}[[:space:]]*:[[:space:]]*${escapeRegExp(value)}[[:space:]]*$`;
  const logArgs = [
    'log', 'HEAD', '--no-merges', '--no-color', '-E', '-i', `--grep=${grep}`,
    ...(opts.since ? [`--since=${opts.since}`] : []),
    `--format=%H%x1f%s%x1f%aI%x1f%(trailers:key=${key},valueonly,separator=%x1d)`,
  ];
  const matches = (await git(logArgs))
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', subject = '', authoredAt = '', trailers = ''] = line.split('\x1f');
      return { sha, subject, authoredAt, trailers: trailers.split('\x1d').map((v) => v.trim()) };
    })
    // The grep also matches a `Key: value` line outside the final trailer paragraph.
    .filter((commit) => commit.trailers.includes(value))
    .slice(0, opts.maxCount ?? DEFAULT_MAX_COUNT);

  const commits: AttributedCommit[] = [];
  for (const { sha, subject, authoredAt } of matches) {
    commits.push({ sha, subject, authoredAt, files: await listCommitFiles(git, sha) });
  }
  return commits;
}

/** The files one commit changed (diff-tree against its first parent; root commits against the empty tree). */
export async function listCommitFilesAt(repoPath: string, sha: string): Promise<AttributedCommitFile[]> {
  const git = async (args: string[]): Promise<string> =>
    (await execFileAsync('git', ['-C', repoPath, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })).stdout;
  return listCommitFiles(git, sha);
}

async function listCommitFiles(git: (args: string[]) => Promise<string>, sha: string): Promise<AttributedCommitFile[]> {
  const base = ['diff-tree', '--root', '-r', '-M', '-z', '--no-commit-id'];

  // numstat: "<add>\t<del>\t<path>", or for a rename "<add>\t<del>\t" then <old>, <new>.
  const counts = new Map<string, { additions: number; deletions: number }>();
  const numFields = (await git([...base, '--numstat', sha])).split('\0');
  for (let i = 0; i < numFields.length; i++) {
    const field = numFields[i];
    if (!field) continue;
    const [add = '', del = '', ...rest] = field.split('\t');
    let path = rest.join('\t');
    if (path === '') {
      path = numFields[i + 2] ?? '';
      i += 2;
    }
    counts.set(path, { additions: toCount(add), deletions: toCount(del) });
  }

  // name-status: <status>, <path>; a rename status (R075) is followed by <old>, <new>.
  const files: AttributedCommitFile[] = [];
  const nameFields = (await git([...base, '--name-status', sha])).split('\0');
  for (let i = 0; i < nameFields.length; i++) {
    const status = nameFields[i];
    if (!status) continue;
    let path: string;
    if (status.startsWith('R')) {
      path = nameFields[i + 2] ?? '';
      i += 2;
    } else {
      path = nameFields[i + 1] ?? '';
      i += 1;
    }
    const count = counts.get(path) ?? { additions: 0, deletions: 0 };
    files.push({ path, status: toStatus(status), ...count });
  }
  return files;
}
