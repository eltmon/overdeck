/**
 * resolveFilePathExists (PAN-1457)
 *
 * Used by the dashboard's MarkdownFileLink to decide whether a path-like
 * token in chat markdown should render as a clickable file chip. The
 * regex heuristic alone produces both false positives (phantom paths
 * like `conv/2209` that look path-shaped but don't exist) and false
 * negatives (bare directory references like `src/components/Foo` that
 * are real but have no extension). This resolver is the authoritative
 * existence gate.
 *
 * Security:
 *   - Pure stat. Never reads file contents, never enumerates directories.
 *   - Treats the result as exists=false for anything that isn't a regular
 *     file or directory (sockets, FIFOs, character devices, etc.).
 *   - Symlinks: we follow them via `stat` (not `lstat`). A symlink that
 *     points to a non-existent target reports exists=false. A symlink
 *     that resolves to a real file/dir reports exists=true. We do not
 *     restrict the *target* — the caller already trusts cwd (the
 *     conversation's working directory it set itself); allowing symlinks
 *     out of cwd is no broader than what the caller could query directly
 *     with an absolute path.
 */

import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { Effect } from 'effect';
import { PanRpcError, type ResolveFilePathExistsInput, type ResolveFilePathExistsResult } from '@overdeck/contracts';

const MAX_PATH_LENGTH = 4096;

export async function resolveFilePathExists(
  input: ResolveFilePathExistsInput,
): Promise<ResolveFilePathExistsResult> {
  const { cwd, path } = input;

  if (path.length === 0 || path.length > MAX_PATH_LENGTH) {
    return { exists: false, kind: null };
  }
  if (cwd.length > MAX_PATH_LENGTH) {
    return { exists: false, kind: null };
  }

  const target = isAbsolute(path) ? path : resolve(cwd, path);

  try {
    const s = await stat(target);
    if (s.isFile()) return { exists: true, kind: 'file' };
    if (s.isDirectory()) return { exists: true, kind: 'dir' };
    return { exists: false, kind: null };
  } catch {
    return { exists: false, kind: null };
  }
}

export function resolveFilePathExistsEffect(
  input: ResolveFilePathExistsInput,
): Effect.Effect<ResolveFilePathExistsResult, PanRpcError> {
  return Effect.tryPromise({
    try: () => resolveFilePathExists(input),
    catch: (error) =>
      new PanRpcError({
        message: `resolveFilePathExists failed: ${error instanceof Error ? error.message : String(error)}`,
        code: 'RESOLVE_FILE_PATH_EXISTS_FAILED',
      }),
  });
}
