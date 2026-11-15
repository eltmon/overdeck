/**
 * The uncommitted files one conversation edited (PAN-5288 WI-3, PRD §6.6).
 *
 * Best effort (PAN-5284 D-5). A file counts as edited by the conversation
 * when its transcript records an edit of it: Claude Code's
 * `fileEditsByAssistantId`, a work-log entry whose tool is edit/write/
 * multiedit/notebookedit with a `file_path` or `path` input (A-D5), or an
 * edit record carrying the written text. Edits made only through shell
 * commands never appear.
 *
 * Line attribution is decided from the data (A-D4): a file with at least one
 * edit record carrying text gets `attribution: 'lines'` — the working-tree
 * plus-lines this conversation did not write are `otherLines`, and other
 * conversations are named only from parses already in the cache. Every
 * other file gets `attribution: 'file'`.
 *
 * Async `execFile` with argument arrays only: the dashboard server calls this.
 */
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { UncommittedFile, WorkLogEntry } from '@overdeck/contracts';

import { turnIdAt } from './conversation-change-commits.js';
import type { ConversationDiffParseResult } from './conversation-diffs.js';

const execFileAsync = promisify(execFile);
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;
const EDIT_TOOL_NAMES = new Set(['edit', 'write', 'multiedit', 'notebookedit']);

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

function editPair(value: unknown): { newText: string; oldText: string } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record['new_string'] !== 'string') return null;
  return { newText: record['new_string'], oldText: typeof record['old_string'] === 'string' ? record['old_string'] : '' };
}

/** True when `toolInput` is an edit record carrying the written text (glossary: "edit record with text"). */
function hasEditText(toolInput: Record<string, unknown>): boolean {
  if (typeof toolInput['file_path'] !== 'string') return false;
  return (
    typeof toolInput['new_string'] === 'string' ||
    typeof toolInput['content'] === 'string' ||
    Array.isArray(toolInput['edits']) ||
    typeof toolInput['new_source'] === 'string'
  );
}

/** The trimmed, non-empty lines an edit record wrote (§6.6 rule 3). */
export function writtenLinesOf(toolInput: Record<string, unknown>): Set<string> {
  const written = new Set<string>();
  const addEdit = (pair: { newText: string; oldText: string } | null): void => {
    if (!pair) return;
    const old = new Set(lines(pair.oldText));
    for (const line of lines(pair.newText)) if (!old.has(line)) written.add(line);
  };
  if (Array.isArray(toolInput['edits'])) {
    for (const edit of toolInput['edits']) addEdit(editPair(edit));
  } else if (typeof toolInput['new_string'] === 'string') {
    addEdit(editPair(toolInput));
  } else if (typeof toolInput['content'] === 'string') {
    for (const line of lines(toolInput['content'])) written.add(line);
  } else if (typeof toolInput['new_source'] === 'string') {
    for (const line of lines(toolInput['new_source'])) written.add(line);
  }
  return written;
}

/** The file an A-D5 edit entry targets (absolute), or null when the entry is not an edit. */
function editEntryPath(entry: WorkLogEntry, cwd: string): string | null {
  const input = entry.toolInput;
  if (!input) return null;
  const tool = (entry.toolTitle ?? entry.label).toLowerCase();
  const raw = typeof input['file_path'] === 'string' ? input['file_path'] : typeof input['path'] === 'string' ? input['path'] : null;
  if (!raw) return null;
  if (!EDIT_TOOL_NAMES.has(tool) && !hasEditText(input)) return null;
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

/** Maps an absolute path to its repo-relative path, or null when it is outside the repository. */
type RepoRelative = (absPath: string) => string | null;

function repoRelativeMapper(repoRoot: string, realRoot: string, realDirs: ReadonlyMap<string, string>): RepoRelative {
  return (absPath) => {
    for (const root of [realRoot, repoRoot]) {
      for (const candidate of [join(realDirs.get(dirname(absPath)) ?? dirname(absPath), basename(absPath)), absPath]) {
        if (candidate.startsWith(root + '/')) return candidate.slice(root.length + 1);
      }
    }
    return null;
  };
}

type EditEvidence = { turnIds: Set<string>; writtenLines: Set<string>; hasText: boolean };

function collectEdits(
  parsed: ConversationDiffParseResult,
  cwd: string,
  toRelative: RepoRelative,
): Map<string, EditEvidence> {
  const files = new Map<string, EditEvidence>();
  const evidence = (rel: string): EditEvidence => {
    let found = files.get(rel);
    if (!found) {
      found = { turnIds: new Set(), writtenLines: new Set(), hasText: false };
      files.set(rel, found);
    }
    return found;
  };

  const keyed = new Set<string>();
  for (const [assistantId, edits] of parsed.fileEditsByAssistantId ?? []) {
    for (const edit of edits) {
      const rel = toRelative(isAbsolute(edit.filePath) ? edit.filePath : resolve(cwd, edit.filePath));
      if (rel === null) continue;
      evidence(rel).turnIds.add(assistantId);
      keyed.add(rel);
    }
  }

  for (const entry of parsed.workLog) {
    const absPath = editEntryPath(entry, cwd);
    if (!absPath) continue;
    const rel = toRelative(absPath);
    if (rel === null) continue;
    const found = evidence(rel);
    // Keyed (Claude) edits already name the exact turn; the time-based rule is for the rest.
    if (!keyed.has(rel)) {
      const turnId = turnIdAt(parsed.messages, entry.createdAt);
      if (turnId) found.turnIds.add(turnId);
    }
    if (entry.toolInput && hasEditText(entry.toolInput)) {
      found.hasText = true;
      for (const line of writtenLinesOf(entry.toolInput)) found.writtenLines.add(line);
    }
  }
  return files;
}

/** Repo-relative path → the conversation's edit evidence (A-D4, A-D5). Paths are compared as written. */
export function editedFiles(input: {
  repoRoot: string;
  cwd: string;
  parsed: ConversationDiffParseResult;
}): Map<string, EditEvidence> {
  return collectEdits(input.parsed, input.cwd, repoRelativeMapper(input.repoRoot, input.repoRoot, new Map()));
}

/** Every directory an edit of `parsed` touches, so realpaths can be resolved before mapping. */
function editDirs(parsed: ConversationDiffParseResult, cwd: string): Set<string> {
  const dirs = new Set<string>();
  for (const edits of parsed.fileEditsByAssistantId?.values() ?? []) {
    for (const edit of edits) dirs.add(dirname(isAbsolute(edit.filePath) ? edit.filePath : resolve(cwd, edit.filePath)));
  }
  for (const entry of parsed.workLog) {
    const absPath = editEntryPath(entry, cwd);
    if (absPath) dirs.add(dirname(absPath));
  }
  return dirs;
}

async function resolveDirs(dirs: Iterable<string>, cache: Map<string, string>): Promise<void> {
  for (const dir of dirs) {
    if (cache.has(dir)) continue;
    cache.set(dir, await realpath(dir).catch(() => dir));
  }
}

interface StatusRecord {
  path: string;
  status: UncommittedFile['status'];
  oldPath?: string;
  untracked: boolean;
}

/** `git status --porcelain=v2 -z --untracked-files=all` records (§6.6 rule 1). */
function parseStatus(out: string): StatusRecord[] {
  const records: StatusRecord[] = [];
  const fields = out.split('\0');
  const rest = (field: string, skip: number): string => field.split(' ').slice(skip).join(' ');
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field === '') continue;
    const kind = field[0];
    if (kind === '1') {
      const xy = field.slice(2, 4);
      const status = xy.includes('D') ? 'D' : xy[0] === 'A' ? 'A' : 'M';
      records.push({ path: rest(field, 8), status, untracked: false });
    } else if (kind === '2') {
      records.push({ path: rest(field, 9), status: 'R', oldPath: fields[i + 1] ?? '', untracked: false });
      i += 1;
    } else if (kind === 'u') {
      records.push({ path: rest(field, 10), status: 'M', untracked: false });
    } else if (kind === '?') {
      records.push({ path: field.slice(2), status: 'A', untracked: true });
    }
  }
  return records;
}

function toCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/** `git diff HEAD --numstat -z --no-renames` counts by path (binary files count 0). */
function parseNumstat(out: string): Map<string, { additions: number; deletions: number }> {
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const field of out.split('\0')) {
    if (field === '') continue;
    const [add = '', del = '', ...pathParts] = field.split('\t');
    counts.set(pathParts.join('\t'), { additions: toCount(add), deletions: toCount(del) });
  }
  return counts;
}

/** Plus-lines (trimmed, non-empty) per path of a `git diff -U0` patch (§6.6 rule 5). */
function plusLinesByPath(patch: string): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  let current: string[] | null = null;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/(.*) b\/\1$/.exec(line);
    if (header) {
      current = [];
      byPath.set(header[1]!, current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk || !line.startsWith('+')) continue;
    const text = line.slice(1).trim();
    if (text !== '') current.push(text);
  }
  return byPath;
}

function lineCount(content: string): number {
  if (content === '') return 0;
  const count = content.split('\n').length;
  return content.endsWith('\n') ? count - 1 : count;
}

async function readUntracked(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_UNTRACKED_BYTES) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** The conversation's edited files that are uncommitted in `repoRoot`, sorted by path. */
export async function listUncommittedFiles(input: {
  repoRoot: string;
  cwd: string;
  parsed: ConversationDiffParseResult;
  others: () => Promise<Array<{ name: string; title: string; parsed: ConversationDiffParseResult }>>;
}): Promise<UncommittedFile[]> {
  const { repoRoot, cwd, parsed } = input;
  const realRoot = await realpath(repoRoot).catch(() => repoRoot);
  const realDirs = new Map<string, string>();
  await resolveDirs(editDirs(parsed, cwd), realDirs);
  const toRelative = repoRelativeMapper(repoRoot, realRoot, realDirs);
  const edited = collectEdits(parsed, cwd, toRelative);
  if (edited.size === 0) return [];

  const records = parseStatus(await git(repoRoot, ['status', '--porcelain=v2', '-z', '--untracked-files=all']))
    .filter((record) => edited.has(record.path));
  if (records.length === 0) return [];

  const hasHead = await git(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(() => true, () => false);
  const isUntracked = (record: StatusRecord): boolean => record.untracked || !hasHead;
  const tracked = records.filter((record) => !isUntracked(record)).map((record) => record.path);
  const counts = tracked.length > 0
    ? parseNumstat(await git(repoRoot, ['diff', 'HEAD', '--numstat', '-z', '--no-renames', '--', ...tracked]))
    : new Map<string, { additions: number; deletions: number }>();

  const trackedText = records.filter((r) => !isUntracked(r) && edited.get(r.path)!.hasText).map((r) => r.path);
  const plusLines = trackedText.length > 0
    ? plusLinesByPath(await git(repoRoot, ['diff', 'HEAD', '-U0', '--no-color', '--no-renames', '--', ...trackedText]))
    : new Map<string, string[]>();

  let othersCache: Array<{ name: string; title: string; parsed: ConversationDiffParseResult }> | null = null;
  const files: UncommittedFile[] = [];
  for (const record of records) {
    const evidence = edited.get(record.path)!;
    let additions = 0;
    let deletions = 0;
    let lineAttribution = evidence.hasText;
    let added: string[] = plusLines.get(record.path) ?? [];
    if (isUntracked(record)) {
      const content = await readUntracked(join(repoRoot, record.path));
      if (content === null) {
        lineAttribution = false;
      } else {
        additions = lineCount(content);
        added = lines(content);
      }
    } else {
      ({ additions, deletions } = counts.get(record.path) ?? { additions: 0, deletions: 0 });
    }

    const file: UncommittedFile = {
      path: record.path,
      status: record.status,
      additions,
      deletions,
      ...(record.oldPath ? { oldPath: record.oldPath } : {}),
      attribution: lineAttribution ? 'lines' : 'file',
      turnIds: [...evidence.turnIds],
    };
    if (lineAttribution) {
      const unmatched = added.filter((line) => !evidence.writtenLines.has(line));
      file.otherLines = unmatched.length;
      if (unmatched.length > 0) {
        othersCache ??= await input.others();
        const named: Array<{ name: string; title: string }> = [];
        for (const other of othersCache) {
          await resolveDirs(editDirs(other.parsed, repoRoot), realDirs);
          const theirs = collectEdits(other.parsed, repoRoot, toRelative).get(record.path);
          if (theirs && unmatched.some((line) => theirs.writtenLines.has(line))) named.push({ name: other.name, title: other.title });
        }
        file.otherConversations = named;
      }
    }
    files.push(file);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
