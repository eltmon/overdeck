/**
 * The lines one conversation changed in one file (PAN-5290 FR-5, C-D2): the
 * `ConversationChangedLines` that
 * `GET /api/conversations/:name/changes/lines?file=<repo path>` serves, for
 * the code pane's gutter marks.
 *
 * `git blame --porcelain` on the working tree gives every line of the file in
 * its current numbering with the commit that last changed it. A line is the
 * conversation's when its commit is one of the conversation's commits that
 * touched the file, or when it is uncommitted (sha all zeros) and the
 * uncommitted record says so: `attribution: 'file'` claims every uncommitted
 * line, `attribution: 'lines'` claims a line whose trimmed text the
 * conversation wrote. Commit hunks cannot answer this, because their line
 * numbers are as of their own commit.
 *
 * When blame fails (an untracked file), an untracked file the conversation
 * changed counts every line as uncommitted; anything else has no lines.
 *
 * Answers are cached per (conversation, file) while HEAD, the file's stat
 * and the transcript's stat are unchanged (C-D2b), so the client's refetch
 * with every `/changes` refetch spawns no second blame. The stamp is taken
 * before any evidence is read, and an answer is cached only when the stamp
 * is the same afterwards and no evidence (blame, the transcript, an added
 * file's text) failed to load; anything else is retried on the next call.
 */
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import type { ConversationChangedLines, ConversationChanges } from '@overdeck/contracts';

import { getConversationChanges, type ConversationChangesDependencies } from './conversation-changes.js';
import { editedFiles } from './conversation-change-uncommitted.js';
import { lookupConversation, repoRootForDir } from './conversation-diffs.js';

const execFileAsync = promisify(execFile);

type LinesResult = { status: number; body: ConversationChangedLines | { error: string } };

export interface ConversationChangedLinesOptions {
  /** `git blame --porcelain` output for `file` in `repoRoot`; injectable so tests count runs. */
  blame?: (repoRoot: string, file: string) => Promise<string>;
}

const CACHE_MAX = 128;
const UNTRACKED_READ_MAX = 2 * 1024 * 1024;
const UNCOMMITTED_SHA = '0'.repeat(40);
const HEADER = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/;

const cache = new Map<string, { stamp: string; body: ConversationChangedLines }>();

function remember(key: string, stamp: string, body: ConversationChangedLines): void {
  cache.delete(key);
  cache.set(key, { stamp, body });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

async function defaultBlame(repoRoot: string, file: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'blame', '--porcelain', '--', file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function headOf(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function statStamp(path: string | null): Promise<string> {
  if (!path) return 'none';
  try {
    const info = await stat(path);
    return `${info.size}:${info.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

/** A repo-relative path: non-empty, not absolute, no NUL and no `..` segment. */
function validFile(file: string): boolean {
  if (file === '' || file.includes('\0') || isAbsolute(file) || file.startsWith('\\')) return false;
  return !file.split(/[\\/]/).includes('..');
}

/** Each working-tree line of a porcelain blame: its final line number, commit and text. */
function parseBlame(out: string): Array<{ line: number; sha: string; content: string }> {
  const lines: Array<{ line: number; sha: string; content: string }> = [];
  let current: { sha: string; line: number } | null = null;
  for (const raw of out.split('\n')) {
    if (raw.startsWith('\t')) {
      if (current) lines.push({ ...current, content: raw.slice(1) });
      current = null;
      continue;
    }
    const header = HEADER.exec(raw);
    if (header) current = { sha: header[1]!, line: Number(header[2]) };
  }
  return lines;
}

/** `GET /api/conversations/:name/changes/lines?file=<repo path>` (FR-5). */
export async function getConversationChangedLines(
  name: string,
  file: string,
  deps: ConversationChangesDependencies,
  opts: ConversationChangedLinesOptions = {},
): Promise<LinesResult> {
  const conv = lookupConversation(name);
  if (!conv) return { status: 404, body: { error: 'Conversation not found' } };
  if (!validFile(file)) return { status: 400, body: { error: 'Invalid file' } };

  const none: LinesResult = { status: 200, body: { path: file, lines: [] } };
  const repoRoot = await repoRootForDir(conv.cwd);
  if (!repoRoot) return none;

  const sessionFile = await deps.resolveSessionFile(conv);
  const absFile = join(repoRoot, file);
  const stampNow = async (): Promise<string> =>
    [await headOf(repoRoot), await statStamp(absFile), await statStamp(sessionFile)].join('\0');
  // Stamped before any evidence is read: an answer is cached only when nothing moved while it was computed.
  const stamp = await stampNow();
  const key = `${name}\0${file}`;
  const cached = cache.get(key);
  if (cached && cached.stamp === stamp) return { status: 200, body: cached.body };

  const result = await getConversationChanges(name, { scope: 'conversation' }, deps);
  if (result.status !== 200) return { status: result.status, body: result.body as { error: string } };
  const changes = result.body as ConversationChanges;

  // False when evidence the answer needs failed to load: the answer is served but never cached.
  let complete = true;
  const answer = async (lines: number[]): Promise<LinesResult> => {
    const body: ConversationChangedLines = { path: file, lines };
    if (complete && (await stampNow()) === stamp) remember(key, stamp, body);
    return { status: 200, body };
  };

  const shas = new Set(changes.commits.filter((c) => c.files.some((f) => f.path === file)).map((c) => c.sha));
  const unc = changes.uncommitted.find((f) => f.path === file);
  if (shas.size === 0 && !unc) return answer([]);

  let written: Set<string> | undefined;
  if (unc?.attribution === 'lines') {
    const parsed = sessionFile ? await deps.getCachedMessages(sessionFile, false).catch(() => null) : null;
    if (parsed) written = editedFiles({ repoRoot, cwd: conv.cwd, parsed }).get(file)?.writtenLines;
    else complete = false;
  }

  let blamed: Array<{ line: number; sha: string; content: string }> = [];
  try {
    blamed = parseBlame(await (opts.blame ?? defaultBlame)(repoRoot, file));
  } catch {
    if (unc?.status === 'A') {
      // C-D2 checkpoint: an added file has no blame; every line of it is uncommitted.
      const info = await stat(absFile).catch(() => null);
      if (info?.isFile() && info.size <= UNTRACKED_READ_MAX) {
        const text = await readFile(absFile, 'utf8').catch(() => null);
        if (text === null) complete = false;
        else {
          const rows = text.split('\n');
          if (rows.at(-1) === '') rows.pop();
          blamed = rows.map((content, i) => ({ line: i + 1, sha: UNCOMMITTED_SHA, content }));
        }
      } else if (!info) complete = false;
    } else if (unc?.status !== 'D') {
      // A deleted file has no lines; any other blame failure is retried on the next request.
      complete = false;
    }
  }

  const marked = new Set<number>();
  for (const { line, sha, content } of blamed) {
    if (shas.has(sha)) {
      marked.add(line);
    } else if (sha === UNCOMMITTED_SHA && unc) {
      const text = content.trim();
      if (unc.attribution === 'file' || (text !== '' && written?.has(text))) marked.add(line);
    }
  }
  return answer([...marked].sort((a, b) => a - b));
}

export function resetConversationChangedLinesCacheForTests(): void {
  cache.clear();
}
