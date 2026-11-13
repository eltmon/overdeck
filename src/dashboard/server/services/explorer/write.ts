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
 */
import { randomBytes } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { PanRpcError, type ExplorerWriteFileResult } from '@overdeck/contracts';
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
 * Resolve a write target. `resolveInsideRoot` refuses a path whose last
 * segment is a dangling symlink as PATH_OUTSIDE_ROOT (its target cannot be
 * checked). For a write that case is "the file the link names does not
 * exist", so it becomes NOT_FOUND. The link is only inspected after its
 * parent folder resolved inside the root.
 */
async function resolveWriteTarget(root: ExplorerRoot, rel: string): Promise<string> {
  try {
    return await resolveInsideRoot(root, rel, { forWrite: true });
  } catch (error) {
    if (!(error instanceof PanRpcError) || error.code !== 'PATH_OUTSIDE_ROOT') throw error;
    const parentRel = posix.dirname(rel);
    let parentAbs: string;
    try {
      parentAbs = await resolveInsideRoot(root, parentRel === '.' ? '' : parentRel, { forWrite: true, allowRoot: true });
    } catch {
      throw error;
    }
    const link = join(parentAbs, posix.basename(rel));
    const linkStats = await lstatOrNull(link);
    if (linkStats?.isSymbolicLink()) {
      try {
        await realpath(link);
      } catch (linkError) {
        if (isMissing(linkError)) throw explorerError('NOT_FOUND', 'Symlink target does not exist');
      }
    }
    throw error;
  }
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
    await rename(tmp, target);
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
