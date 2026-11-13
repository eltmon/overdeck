/**
 * Explorer search (PAN-5183, FR-6).
 *
 * `searchFiles` fuzzy-matches file names over `git ls-files` (tracked plus
 * untracked, non-ignored), cached per root for 30 s. `searchContent` runs
 * `git grep` and converts its byte columns to UTF-16 columns.
 */
import type { ExplorerSearchContentMatch, ExplorerSearchContentResult } from '@overdeck/contracts';
import { explorerError } from './errors.js';
import { runGit } from './git-exec.js';
import { resolveInsideRoot } from './paths.js';
import type { ExplorerRoot } from './roots.js';

const FILE_LIST_TTL_MS = 30_000;
const MAX_LIMIT = 500;
const GREP_TIMEOUT_MS = 5_000;
const GREP_MAX_BYTES = 16 * 1024 * 1024;
const PREVIEW_LENGTH = 240;

export interface SearchClock {
  now?: () => number;
}

const fileListCache = new Map<string, { at: number; paths: string[] }>();

/** Drops a root's cached file list, so the next searchFiles call re-lists. */
export function invalidateFileListCache(rootId: string): void {
  fileListCache.delete(rootId);
}

async function fileList(root: ExplorerRoot, now: number): Promise<string[]> {
  const cached = fileListCache.get(root.id);
  if (cached && now - cached.at < FILE_LIST_TTL_MS) return cached.paths;
  const run = await runGit(root.absPath, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  if (run.code !== 0) throw explorerError('NOT_A_GIT_REPO', `Root ${root.id} is not inside a git checkout`);
  const paths = [...new Set(run.stdout.toString('utf8').split('\0').filter((p) => p !== ''))];
  fileListCache.set(root.id, { at: now, paths });
  return paths;
}

const WORD_BOUNDARY = new Set(['/', '_', '-', '.', ' ']);

/**
 * Greedy left-to-right subsequence match. Each matched character scores 1,
 * plus 3 at a word start, plus 5 when it directly follows the previous
 * matched character. Null when `query` is not a subsequence of `path`.
 */
export function fuzzyScore(path: string, query: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (q === '') return null;
  const p = path.toLowerCase();
  let score = 0;
  let previous = -2;
  let from = 0;
  for (const ch of q) {
    const i = p.indexOf(ch, from);
    if (i < 0) return null;
    score += 1;
    if (i === 0 || WORD_BOUNDARY.has(p[i - 1]!)) score += 3;
    if (i === previous + 1) score += 5;
    previous = i;
    from = i + 1;
  }
  return score;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export async function searchFiles(
  root: ExplorerRoot,
  query: string,
  limit: number,
  opts: SearchClock = {},
): Promise<{ paths: string[] }> {
  const paths = await fileList(root, (opts.now ?? Date.now)());
  const scored: Array<{ path: string; score: number }> = [];
  for (const path of paths) {
    const score = fuzzyScore(path, query);
    if (score !== null) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return { paths: scored.slice(0, clampLimit(limit)).map((s) => s.path) };
}

/**
 * Parses `git grep -n --column -z` output: `path\0line\0column\0text\n` per
 * match. A trailing line with no newline (git was cut off) is dropped.
 */
function parseGrep(stdout: string): Array<{ path: string; line: number; column: number; text: string }> {
  const out: Array<{ path: string; line: number; column: number; text: string }> = [];
  let pos = 0;
  while (pos < stdout.length) {
    const a = stdout.indexOf('\0', pos);
    const b = a < 0 ? -1 : stdout.indexOf('\0', a + 1);
    const c = b < 0 ? -1 : stdout.indexOf('\0', b + 1);
    const end = c < 0 ? -1 : stdout.indexOf('\n', c + 1);
    if (end < 0) break; // a partial last line (or malformed output)
    out.push({
      path: stdout.slice(pos, a),
      line: Number.parseInt(stdout.slice(a + 1, b), 10),
      column: Number.parseInt(stdout.slice(b + 1, c), 10),
      text: stdout.slice(c + 1, end),
    });
    pos = end + 1;
  }
  return out;
}

/** Converts git's 1-based byte column in `text` to a 1-based UTF-16 column. */
function utf16Column(text: string, byteColumn: number): number {
  return Buffer.from(text, 'utf8').subarray(0, Math.max(0, byteColumn - 1)).toString('utf8').length + 1;
}

export async function searchContent(
  root: ExplorerRoot,
  input: { query: string; scopePath?: string; regex: boolean; caseSensitive: boolean; limit: number },
): Promise<ExplorerSearchContentResult> {
  if (input.query === '') return { matches: [], truncated: false };
  const limit = clampLimit(input.limit);
  const scope = input.scopePath ? input.scopePath : undefined;
  if (scope) await resolveInsideRoot(root, scope, { forWrite: false });

  const run = await runGit(
    root.absPath,
    [
      'grep',
      '-n',
      '--column',
      '-I',
      '--untracked',
      '--no-color',
      '--max-count=20',
      '-z',
      input.regex ? '-E' : '-F',
      ...(input.caseSensitive ? [] : ['-i']),
      '-e',
      input.query,
      ...(scope ? ['--', scope] : []),
    ],
    { timeoutMs: GREP_TIMEOUT_MS, maxBytes: GREP_MAX_BYTES },
  );

  const cut = run.timedOut || run.truncated;
  if (!cut) {
    if (run.code === 1) return { matches: [], truncated: false };
    if (run.code === 128 && input.regex) {
      throw explorerError('INVALID_QUERY', run.stderr.split('\n')[0]?.trim() || 'invalid regular expression');
    }
    if (run.code !== 0) throw explorerError('EXPLORER_FAILED', `git grep failed: ${run.stderr.trim() || `exit ${run.code}`}`);
  }

  const lines = parseGrep(run.stdout.toString('utf8'));
  const matches: ExplorerSearchContentMatch[] = lines.slice(0, limit).map((l) => ({
    path: l.path,
    line: l.line,
    column: utf16Column(l.text, l.column),
    preview: l.text.slice(0, PREVIEW_LENGTH),
  }));
  return { matches, truncated: cut || lines.length > limit };
}
