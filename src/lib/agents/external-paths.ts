/**
 * Path rules for external agent files (PAN-3920 Phase C, #4038 review).
 *
 * A registration names files another tool wrote: a transcript, a job log, a
 * rollout. Overdeck reads them on every directory build, so each path is
 * checked at registration AND again before every read (the file can be
 * replaced later):
 *
 *   - `realpath` must land under an allowed root (symlinks cannot escape);
 *   - the target must be a regular file (never a FIFO, device or directory);
 *   - reads open with O_NONBLOCK and re-check the opened descriptor with
 *     `fstat`, so a file swapped for a FIFO between check and open can never
 *     block a libuv thread.
 *
 * Transcript roots: `~/.claude/projects`, the Codex sessions directory
 * (`$CODEX_HOME/sessions`, default `~/.codex/sessions`) and
 * `~/.overdeck/agents`.
 */
import { constants } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { getOverdeckHome } from '../paths.js';

export type PathCheck = { ok: true; path: string } | { ok: false; error: string };

export function codexHomeDir(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
}

/** The directories a registered transcript may live under. */
export function externalTranscriptRoots(): string[] {
  return [
    join(homedir(), '.claude', 'projects'),
    join(codexHomeDir(), 'sessions'),
    join(getOverdeckHome(), 'agents'),
  ];
}

async function canonicalRoot(root: string): Promise<string> {
  return realpath(root).catch(() => resolve(root));
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * The canonical path of a regular file under one of `roots`, or why not.
 * Never opens the file: `realpath` and `stat` do not block on a FIFO.
 */
export async function checkRegularFileUnder(path: string, roots: readonly string[]): Promise<PathCheck> {
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    return { ok: false, error: `${path} does not exist` };
  }
  const canonicalRoots = await Promise.all(roots.map(canonicalRoot));
  if (!canonicalRoots.some((root) => isUnder(real, root))) {
    return { ok: false, error: `${path} is outside the allowed directories (${roots.join(', ')})` };
  }
  try {
    if (!(await stat(real)).isFile()) return { ok: false, error: `${path} is not a regular file` };
  } catch {
    return { ok: false, error: `${path} does not exist` };
  }
  return { ok: true, path: real };
}

export function checkTranscriptPath(path: string): Promise<PathCheck> {
  return checkRegularFileUnder(path, externalTranscriptRoots());
}

/**
 * Open a regular file for reading without ever blocking: O_NONBLOCK makes
 * opening a FIFO return at once, and the descriptor is refused unless it is a
 * regular file. Null when the path cannot be opened or is not a regular file.
 */
export async function openRegularFile(path: string): Promise<FileHandle | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    if ((await handle.stat()).isFile()) return handle;
  } catch { /* fall through */ }
  await handle.close().catch(() => {});
  return null;
}

/** Read at most `maxBytes` of a regular file, from its start or its end; null when it is not a readable regular file. */
export async function readRegularFile(path: string, maxBytes: number, from: 'head' | 'tail' = 'head'): Promise<string | null> {
  const handle = await openRegularFile(path);
  if (!handle) return null;
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const start = from === 'tail' ? size - length : 0;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close().catch(() => {});
  }
}
