// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/server/src/workspace/WorkspaceFileSystem.ts @ 2d8a843e6b
/**
 * Git metadata guard (PAN-5183). Explorer writes must never reach a git
 * folder: a repository's config and hooks can execute code. Logic is
 * unchanged from upstream; only the module shape differs.
 */
import { lstat } from 'node:fs/promises';
import path from 'node:path';

// NTFS reaches .git through trailing dots/spaces, stream suffixes and GIT~1; compare uppercased names.
export const isGitMetadataName = (segment: string): boolean => {
  const name = (segment.split(':')[0] ?? '').replace(/[. ]+$/, '').toUpperCase();
  return name === '.GIT' || name === 'GIT~1';
};

// Reject Git folders, including renamed bare repos whose config/hooks can execute; paths must be normalized.
// Stop at linked worktrees' .git files since worktrees can sit inside bare repos.
export const isInGitFolder = async (absolutePath: string): Promise<boolean> => {
  if (absolutePath.split(path.sep).some(isGitMetadataName)) return true;
  for (let folder = path.dirname(absolutePath); ; folder = path.dirname(folder)) {
    const [head, commondir, objects, refs, dotGit] = await Promise.all(
      ['HEAD', 'commondir', 'objects', 'refs', '.git'].map((name) =>
        lstat(path.join(folder, name)).catch((error: NodeJS.ErrnoException) => {
          // Any other failure leaves the folder unknown, so the write is refused.
          if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
          throw error;
        }),
      ),
    );
    // Git recognizes HEAD with commondir or objects/refs as a repository.
    if (head && (commondir || (objects && refs))) return true;
    if (dotGit?.isFile() || path.dirname(folder) === folder) return false;
  }
};
