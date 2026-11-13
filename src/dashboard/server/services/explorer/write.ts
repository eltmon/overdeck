/**
 * Explorer write door (PAN-5187, FR-8, NFR-1, NFR-3).
 *
 * `writeFile` saves the text of a code pane to a file inside an explorer
 * root. Every write carries the disk signature the editor last loaded or
 * saved, and the server refuses the write when the file changed since:
 *
 *   | file on disk | expectedSignature | allowMissing | result                       |
 *   |--------------|-------------------|--------------|------------------------------|
 *   | exists       | null              | any          | write (explicit Overwrite)   |
 *   | exists       | equals current    | any          | write                        |
 *   | exists       | differs           | any          | DISK_CONFLICT                |
 *   | missing      | null              | any          | create file and parent dirs  |
 *   | missing      | a string          | true         | create file and parent dirs  |
 *   | missing      | a string          | false        | DISK_CONFLICT                |
 *
 * Symlinks: a link that resolves inside the root is followed, so the write
 * replaces the link's real target and the link stays a link
 * (`resolveInsideRoot` returns the realpath). A dangling link is refused
 * with NOT_FOUND and nothing is created.
 *
 * The write is atomic: a temp file next to the target is written, fsynced,
 * given the old file's mode, and renamed over the target.
 *
 * Accepted race: the signature check and the rename are two steps, so a
 * process that writes the file between them is overwritten. Orca has the
 * same window; closing it would need a lock no other editor honours.
 *
 * The tree's file actions use the entry operations below them: `create`
 * (empty file or folder), `rename` (rename and move, through `moveEntry`,
 * which falls back to copy-and-remove across filesystems), `copy` and
 * `statEntry`. They resolve paths with
 * `resolveEntryInsideRoot`, which never follows a symlink in the last
 * segment, so they act on a link and not on its target.
 */
import { randomBytes } from 'node:crypto';
import type { Stats } from 'node:fs';
import { cp, lstat, mkdir, open, readFile, realpath, rename as fsRename, rm, stat, writeFile as fsWriteFile } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { PanRpcError, type ExplorerEntry, type ExplorerEntryResult, type ExplorerWriteFileResult } from '@overdeck/contracts';
import { explorerError } from './errors.js';
import { resolveInsideRoot } from './paths.js';
import type { ExplorerRoot } from './roots.js';
import { diskSignature, writtenContentDiskSignature } from './signature.js';

/** Largest text a code pane may save, in UTF-8 bytes (D-C5). Matches read.ts's large-text threshold. */
export const MAX_EDITABLE_TEXT_BYTES = 5 * 1024 * 1024;

/** Marker in the name of the temp file an atomic write renames over its target. */
export const WRITE_TEMP_MARKER = '.overdeck-tmp-';

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function lstatOrNull(abs: string): Promise<Stats | null> {
  try {
    return await lstat(abs);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * Resolve the parent folder of `rel` inside the root and lstat the last
 * segment there, without following it. Null when the parent does not
 * resolve (the caller then reports its own error).
 */
async function lstatLastSegment(
  root: ExplorerRoot,
  rel: string,
  forWrite: boolean,
): Promise<{ abs: string; stats: Stats | null } | null> {
  const parentRel = posix.dirname(rel);
  let parentAbs: string;
  try {
    parentAbs = await resolveInsideRoot(root, parentRel === '.' ? '' : parentRel, { forWrite, allowRoot: true });
  } catch {
    return null;
  }
  const abs = join(parentAbs, posix.basename(rel));
  return { abs, stats: await lstatOrNull(abs) };
}

/**
 * Absolute path of the entry `rel` names, with a symlink in its last
 * segment left unresolved, so rename, copy and delete act on the link and
 * not on what it points at. A link whose target is missing or outside the
 * root is still an entry of the root. Every other path is checked by
 * `resolveInsideRoot` first.
 */
export async function resolveEntryInsideRoot(root: ExplorerRoot, rel: string, forWrite = true): Promise<string> {
  try {
    await resolveInsideRoot(root, rel, { forWrite });
  } catch (error) {
    if (!(error instanceof PanRpcError) || error.code !== 'PATH_OUTSIDE_ROOT') throw error;
    const last = await lstatLastSegment(root, rel, forWrite);
    if (last?.stats?.isSymbolicLink()) return last.abs;
    throw error;
  }
  const last = await lstatLastSegment(root, rel, forWrite);
  if (!last) throw explorerError('PATH_OUTSIDE_ROOT', `${JSON.stringify(rel)} has no parent folder inside the root`);
  return last.abs;
}

/**
 * Resolve a write target, following a symlink in the last segment.
 * `resolveInsideRoot` refuses a dangling link as PATH_OUTSIDE_ROOT (its
 * target cannot be checked). For a write that case is "the file the link
 * names does not exist", so it becomes NOT_FOUND. The link is only
 * inspected after its parent folder resolved inside the root.
 */
async function resolveWriteTarget(root: ExplorerRoot, rel: string): Promise<string> {
  try {
    return await resolveInsideRoot(root, rel, { forWrite: true });
  } catch (error) {
    if (!(error instanceof PanRpcError) || error.code !== 'PATH_OUTSIDE_ROOT') throw error;
    const last = await lstatLastSegment(root, rel, true);
    if (last?.stats?.isSymbolicLink()) {
      try {
        await realpath(last.abs);
      } catch (linkError) {
        if (isMissing(linkError)) throw explorerError('NOT_FOUND', 'Symlink target does not exist');
      }
    }
    throw error;
  }
}

function entryKind(stats: Stats): ExplorerEntry['kind'] {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'dir';
  return 'file';
}

/**
 * The tree entry for `rel` (D-C11). `ignored` is always false: the watcher
 * event that follows a change makes the tree re-list, which corrects it.
 */
export async function statEntry(root: ExplorerRoot, rel: string): Promise<ExplorerEntry> {
  const stats = await lstat(await resolveEntryInsideRoot(root, rel, false));
  const kind = entryKind(stats);
  return {
    name: posix.basename(rel),
    path: rel,
    kind,
    ...(kind === 'file' ? { size: stats.size } : {}),
    mtimeMs: stats.mtimeMs,
    ignored: false,
  };
}

async function writeAtomically(target: string, text: string, mode: number | null): Promise<void> {
  const tmp = join(dirname(target), `.${basename(target)}${WRITE_TEMP_MARKER}${randomBytes(6).toString('hex')}`);
  try {
    const fh = await open(tmp, 'wx');
    try {
      await fh.writeFile(text, 'utf8');
      if (mode !== null) await fh.chmod(mode);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsRename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export async function writeFile(
  root: ExplorerRoot,
  rel: string,
  text: string,
  expectedSignature: string | null,
  allowMissing: boolean,
): Promise<ExplorerWriteFileResult> {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_EDITABLE_TEXT_BYTES) {
    throw explorerError(
      'FILE_TOO_LARGE',
      `${JSON.stringify(rel)} is ${bytes} bytes; files over ${MAX_EDITABLE_TEXT_BYTES} bytes cannot be saved from the editor`,
    );
  }

  const target = await resolveWriteTarget(root, rel);
  const existing = await lstatOrNull(target);

  if (existing) {
    if (existing.isDirectory()) throw explorerError('ALREADY_EXISTS', 'A folder exists at this path');
    if (!existing.isFile()) throw explorerError('ALREADY_EXISTS', `${JSON.stringify(rel)} is not a regular file`);
    if (expectedSignature !== null) {
      const current = diskSignature(new TextDecoder('utf-8').decode(await readFile(target)));
      if (current !== expectedSignature) {
        throw explorerError('DISK_CONFLICT', `${JSON.stringify(rel)} changed on disk since it was loaded`);
      }
    }
  } else {
    if (expectedSignature !== null && !allowMissing) {
      throw explorerError('DISK_CONFLICT', `${JSON.stringify(rel)} no longer exists on disk`);
    }
    await mkdir(dirname(target), { recursive: true });
  }

  await writeAtomically(target, text, existing ? existing.mode & 0o7777 : null);

  return { signature: writtenContentDiskSignature(text), mtimeMs: (await stat(target)).mtimeMs };
}

/** Create an empty file or a folder at `rel`, with any missing parent folders. */
export async function create(root: ExplorerRoot, rel: string, kind: 'file' | 'dir'): Promise<ExplorerEntryResult> {
  const abs = await resolveEntryInsideRoot(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  try {
    if (kind === 'file') await fsWriteFile(abs, '', { flag: 'wx' });
    else await mkdir(abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw explorerError('ALREADY_EXISTS', `${JSON.stringify(rel)} already exists`);
    }
    throw error;
  }
  return { entry: await statEntry(root, rel) };
}

/** The filesystem calls `moveEntry` makes; tests inject them to simulate EXDEV. */
export interface MoveOps {
  rename: typeof fsRename;
  cp: typeof cp;
  rm: typeof rm;
}

const defaultMoveOps: MoveOps = { rename: fsRename, cp, rm };

/**
 * Move a file or folder (D-C9). `rename` cannot cross filesystems (EXDEV),
 * so that case copies the entry, symlinks verbatim, then removes the source.
 */
export async function moveEntry(from: string, to: string, ops: MoveOps = defaultMoveOps): Promise<void> {
  try {
    await ops.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await ops.cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    await ops.rm(from, { recursive: true, force: true });
  }
}

/** True when `to` is `from` or lies inside it (D-C10). */
function isSelfOrInside(from: string, to: string): boolean {
  return to === from || to.startsWith(`${from}/`);
}

/** Missing source, or a source that is a parent of the target, throws before anything moves. */
async function sourceAndTarget(
  root: ExplorerRoot,
  from: string,
  to: string,
  verb: string,
): Promise<{ fromAbs: string; toAbs: string; source: Stats; target: Stats | null }> {
  const fromAbs = await resolveEntryInsideRoot(root, from);
  const toAbs = await resolveEntryInsideRoot(root, to);
  const source = await lstatOrNull(fromAbs);
  if (!source) throw explorerError('NOT_FOUND', `${JSON.stringify(from)} does not exist`);
  if (isSelfOrInside(from, to)) {
    throw explorerError('INVALID_TARGET', `Cannot ${verb} ${JSON.stringify(from)} into itself`);
  }
  return { fromAbs, toAbs, source, target: await lstatOrNull(toAbs) };
}

/**
 * Rename or move `from` to `to`. The target folder must exist. A target
 * that is the same inode as the source (a case-only rename on a
 * case-insensitive filesystem) is not a collision.
 */
export async function rename(root: ExplorerRoot, from: string, to: string): Promise<ExplorerEntryResult> {
  const { fromAbs, toAbs, source, target } = await sourceAndTarget(root, from, to, 'move');
  if (target && (target.dev !== source.dev || target.ino !== source.ino)) {
    throw explorerError('ALREADY_EXISTS', `${JSON.stringify(to)} already exists`);
  }
  const parent = await stat(dirname(toAbs)).catch(() => null);
  if (!parent?.isDirectory()) {
    throw explorerError('NOT_FOUND', `The folder for ${JSON.stringify(to)} does not exist`);
  }
  await moveEntry(fromAbs, toAbs);
  return { entry: await statEntry(root, to) };
}

/** Copy a file or folder to `to`, symlinks verbatim. The target must be free. */
export async function copy(root: ExplorerRoot, from: string, to: string): Promise<ExplorerEntryResult> {
  const { fromAbs, toAbs, target } = await sourceAndTarget(root, from, to, 'copy');
  if (target) throw explorerError('ALREADY_EXISTS', `${JSON.stringify(to)} already exists`);
  await cp(fromAbs, toAbs, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  return { entry: await statEntry(root, to) };
}
