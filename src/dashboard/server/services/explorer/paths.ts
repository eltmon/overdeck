/**
 * Explorer path safety (PAN-5183, NFR-3).
 *
 * `resolveInsideRoot` turns a root-relative POSIX path into an absolute path
 * that is guaranteed to sit inside the root after every symlink is resolved.
 * With `forWrite` it also refuses project roots (read-only) and any path in
 * a git folder.
 */
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { isInsidePath } from '../file-at-path.js';
import { explorerError } from './errors.js';
import { isGitMetadataName, isInGitFolder } from './git-dir-guard.js';
import type { ExplorerRoot } from './roots.js';

export interface ResolveOptions {
  forWrite: boolean;
  /** Allow `''` to name the root itself. */
  allowRoot?: boolean;
}

function outside(rel: string, why: string) {
  return explorerError('PATH_OUTSIDE_ROOT', `${JSON.stringify(rel)} ${why}`);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export async function resolveInsideRoot(root: ExplorerRoot, rel: string, opts: ResolveOptions): Promise<string> {
  if (opts.forWrite && root.kind === 'project') {
    throw explorerError('EDIT_WORKSPACE_REQUIRED', `${root.id} is read-only; open an edit workspace to change files`);
  }

  if (rel === '') {
    if (opts.allowRoot) return root.absPath;
    throw outside(rel, 'names the root itself');
  }

  if (rel.startsWith('/')) throw outside(rel, 'is absolute');
  if (rel.includes('\\')) throw outside(rel, 'contains a backslash');
  if (rel.includes('\0')) throw outside(rel, 'contains a NUL byte');
  if (/^[A-Za-z]:/.test(rel)) throw outside(rel, 'has a drive prefix');
  const segments = rel.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw outside(rel, 'has an empty, "." or ".." segment');
  }

  if (opts.forWrite && segments.some(isGitMetadataName)) {
    throw explorerError('PATH_IN_GIT_DIR', `${JSON.stringify(rel)} is inside a git folder`);
  }

  // Find the nearest ancestor that exists (the full path when it exists).
  // An entry that exists counts even when it is a dangling symlink: its
  // target cannot be checked, so the path is refused rather than joined.
  let existing = segments.length;
  for (; existing > 0; existing--) {
    try {
      await lstat(join(root.absPath, ...segments.slice(0, existing)));
      break;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  let real: string;
  try {
    real = await realpath(join(root.absPath, ...segments.slice(0, existing)));
  } catch (error) {
    if (isMissing(error)) throw outside(rel, 'passes through a dangling symlink');
    throw error;
  }
  if (!isInsidePath(root.absPath, real)) throw outside(rel, 'resolves outside the root');

  const result = join(real, ...segments.slice(existing));

  if (opts.forWrite && (await isInGitFolder(result))) {
    throw explorerError('PATH_IN_GIT_DIR', `${JSON.stringify(rel)} is inside a git folder`);
  }

  return result;
}
