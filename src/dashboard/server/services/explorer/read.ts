/**
 * Explorer directory listing and file reads (PAN-5183, FR-2, NFR-4).
 *
 * `listDir` lists one directory lazily (no recursion, no sort) and flags
 * git-ignored entries. `readFile` reads a file from disk, or its committed
 * version with `ref: 'HEAD'`, and classifies it as text, binary or
 * large-text. Both resolve paths through `resolveInsideRoot`.
 */
import { constants, type Stats } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExplorerEntry, ExplorerListDirResult, ExplorerReadFileResult } from '@overdeck/contracts';
import { languageForPath } from '../read-workspace-file.js';
import { explorerError, toExplorerRpcError } from './errors.js';
import { runGit } from './git-exec.js';
import { resolveInsideRoot } from './paths.js';
import type { ExplorerRoot } from './roots.js';
import { diskSignature } from './signature.js';

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_LARGE_TEXT_BYTES = 5 * 1024 * 1024;
const LSTAT_BATCH = 64;
const SNIFF_BYTES = 8192;

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function entryKind(stats: Stats): ExplorerEntry['kind'] {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'dir';
  return 'file';
}

/** Root-relative paths git ignores, or an empty set when git cannot say (not a repo). */
async function ignoredPaths(root: ExplorerRoot, rel: string, paths: readonly string[]): Promise<Set<string> | 'all'> {
  if (paths.length === 0) return new Set();
  if (rel !== '') {
    const self = await runGit(root.absPath, ['check-ignore', '-q', '--', rel]);
    if (self.code === 0) return 'all';
  }
  const result = await runGit(root.absPath, ['check-ignore', '-z', '--stdin'], { input: `${paths.join('\0')}\0` });
  if (result.code !== 0 && result.code !== 1) return new Set();
  return new Set(result.stdout.toString('utf8').split('\0').filter((p) => p !== ''));
}

export async function listDir(
  root: ExplorerRoot,
  rel: string,
  opts: { maxEntries?: number } = {},
): Promise<ExplorerListDirResult> {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const dir = await resolveInsideRoot(root, rel, { forWrite: false, allowRoot: true });

  let handle;
  try {
    handle = await opendir(dir);
  } catch (error) {
    if (isMissing(error)) throw explorerError('NOT_FOUND', `${JSON.stringify(rel)} is not a directory`);
    throw toExplorerRpcError(error);
  }

  const names: string[] = [];
  let truncated = false;
  for await (const dirent of handle) {
    if (names.length >= maxEntries) {
      truncated = true;
      break; // ends the iterator, which closes the handle
    }
    names.push(dirent.name);
  }

  const entries: ExplorerEntry[] = [];
  for (let i = 0; i < names.length; i += LSTAT_BATCH) {
    const batch = names.slice(i, i + LSTAT_BATCH);
    const stats = await Promise.all(
      batch.map((name) =>
        lstat(join(dir, name)).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; // deleted meanwhile
          throw toExplorerRpcError(error);
        }),
      ),
    );
    batch.forEach((name, j) => {
      const s = stats[j];
      if (!s) return;
      const kind = entryKind(s);
      entries.push({
        name,
        path: rel === '' ? name : `${rel}/${name}`,
        kind,
        ...(kind === 'file' ? { size: s.size } : {}),
        mtimeMs: s.mtimeMs,
        ignored: false,
      });
    });
  }

  const ignored = await ignoredPaths(root, rel, entries.map((e) => e.path));
  const flagged = entries.map((e) => ({ ...e, ignored: ignored === 'all' || ignored.has(e.path) }));

  return { entries: flagged, truncated, absPath: dir };
}

function classify(
  sniff: Uint8Array,
  size: number,
  largeTextBytes: number,
): 'binary' | 'large-text' | 'text' {
  if (sniff.includes(0)) return 'binary';
  if (size > largeTextBytes) return 'large-text';
  return 'text';
}

async function readHeadFile(root: ExplorerRoot, rel: string, abs: string, largeTextBytes: number): Promise<ExplorerReadFileResult> {
  const lang = languageForPath(abs);
  const spec = `HEAD:./${rel}`;
  const sized = await runGit(root.absPath, ['cat-file', '-s', spec]);
  if (sized.code !== 0) {
    return { kind: 'text', text: '', size: 0, mtimeMs: 0, signature: diskSignature(''), lang, writable: false };
  }
  const size = Number.parseInt(sized.stdout.toString('utf8').trim(), 10);
  if (size > largeTextBytes) {
    return { kind: 'large-text', size, mtimeMs: 0, signature: '', lang, writable: false };
  }
  const shown = await runGit(root.absPath, ['show', spec], { maxBytes: largeTextBytes + 1 });
  if (shown.code !== 0) {
    throw explorerError('EXPLORER_FAILED', `git show ${spec} failed: ${shown.stderr.trim()}`);
  }
  const bytes = shown.stdout;
  const kind = classify(bytes.subarray(0, SNIFF_BYTES), size, largeTextBytes);
  if (kind !== 'text') return { kind, size, mtimeMs: 0, signature: '', lang, writable: false };
  const text = new TextDecoder('utf-8').decode(bytes);
  return { kind, text, size, mtimeMs: 0, signature: diskSignature(text), lang, writable: false };
}

export async function readFile(
  root: ExplorerRoot,
  rel: string,
  opts: { ref?: 'HEAD'; largeTextBytes?: number } = {},
): Promise<ExplorerReadFileResult> {
  const largeTextBytes = opts.largeTextBytes ?? DEFAULT_LARGE_TEXT_BYTES;
  const abs = await resolveInsideRoot(root, rel, { forWrite: false });
  if (opts.ref === 'HEAD') return readHeadFile(root, rel, abs, largeTextBytes);

  let handle;
  try {
    // O_NONBLOCK: opening a FIFO must not hang the read.
    handle = await open(abs, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (isMissing(error)) throw explorerError('NOT_FOUND', `${JSON.stringify(rel)} does not exist`);
    throw toExplorerRpcError(error);
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw explorerError('NOT_FOUND', `${JSON.stringify(rel)} is not a regular file`);
    const lang = languageForPath(abs);
    const base = { size: stats.size, mtimeMs: stats.mtimeMs, lang, writable: root.writable };

    const sniff = new Uint8Array(Math.min(stats.size, SNIFF_BYTES));
    const { bytesRead } = await handle.read(sniff, 0, sniff.length, 0);
    const kind = classify(sniff.subarray(0, bytesRead), stats.size, largeTextBytes);
    if (kind !== 'text') return { kind, signature: '', ...base };

    const bytes = await handle.readFile();
    const text = new TextDecoder('utf-8').decode(bytes);
    return { kind, text, signature: diskSignature(text), ...base };
  } finally {
    await handle.close();
  }
}
