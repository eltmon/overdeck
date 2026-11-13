/**
 * Explorer upload sink (PAN-5188, PRD §6.5, D-6).
 *
 * Streams an upload to a temp file in the target directory, counting bytes
 * against a cap, then commits with link-then-unlink: `link` fails with EEXIST
 * atomically when the name is taken (including a file that appeared while the
 * body streamed), so an upload never replaces an existing file. The temp file
 * sits in the same directory, so the link never crosses filesystems.
 */
import { randomBytes } from 'node:crypto';
import { link, open, stat, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { explorerError } from './errors.js';

export const EXPLORER_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

const MAX_NAME_BYTES = 255;

/** null when `name` is a valid single file name; otherwise the reason it is not. */
export function validateUploadName(name: string): string | null {
  if (name === '') return 'name is required';
  if (name === '.' || name === '..') return `${JSON.stringify(name)} is not a file name`;
  if (/[/\\\0]/u.test(name)) return 'name must not contain /, \\ or NUL';
  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) return `name is longer than ${MAX_NAME_BYTES} bytes`;
  return null;
}

export interface UploadSink {
  write(chunk: Uint8Array): Promise<void>;
  commit(): Promise<{ path: string; size: number; mtimeMs: number }>;
  abort(): Promise<void>;
}

function errnoOf(error: unknown): unknown {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (errnoOf(error) !== 'ENOENT') throw error;
  }
}

export async function openUploadSink(
  targetAbs: string,
  targetRel: string,
  maxBytes: number = EXPLORER_UPLOAD_MAX_BYTES,
): Promise<UploadSink> {
  // Fixed-length temp name, so a 255-byte target name cannot push it past the name limit.
  const temp = join(dirname(targetAbs), `.overdeck-upload-${randomBytes(8).toString('hex')}`);
  let handle: FileHandle | null = await open(temp, 'wx');
  let size = 0;

  const closeHandle = async (): Promise<void> => {
    const current = handle;
    handle = null;
    await current?.close();
  };

  return {
    async write(chunk) {
      if (!handle) throw new Error('upload sink is closed');
      size += chunk.length;
      if (size > maxBytes) throw explorerError('FILE_TOO_LARGE', `upload is larger than ${maxBytes} bytes`);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        offset += bytesWritten;
      }
    },

    async commit() {
      if (!handle) throw new Error('upload sink is closed');
      await handle.sync();
      await closeHandle();
      try {
        await link(temp, targetAbs);
      } catch (error) {
        await unlinkIfPresent(temp);
        if (errnoOf(error) === 'EEXIST') {
          throw explorerError('ALREADY_EXISTS', `${JSON.stringify(targetRel)} already exists`);
        }
        throw error;
      }
      await unlink(temp);
      const written = await stat(targetAbs);
      return { path: targetRel, size: written.size, mtimeMs: written.mtimeMs };
    },

    async abort() {
      try {
        await closeHandle();
      } finally {
        await unlinkIfPresent(temp);
      }
    },
  };
}
