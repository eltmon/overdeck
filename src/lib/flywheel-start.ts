import { exec } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const DEFAULT_BRIEF_PATH = 'docs/flywheel-brief.md';

function isInsideRoot(projectRoot: string, candidate: string): boolean {
  const relativePath = relative(projectRoot, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function resolveFlywheelStartBriefPath(cwd: string, requestedPath?: string): { absolutePath: string; displayPath: string } {
  const rawPath = requestedPath?.trim() || DEFAULT_BRIEF_PATH;
  if (rawPath.includes('\0')) throw new Error('Brief path is invalid');

  const root = resolve(cwd);
  const absolutePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath);
  if (!isInsideRoot(root, absolutePath)) throw new Error('Brief path must stay inside the project root');

  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  const displayPath = absolutePath === root ? '.' : relative(root, absolutePath);
  return { absolutePath, displayPath: absolutePath.startsWith(normalizedRoot) ? displayPath : absolutePath };
}

async function assertExistingPathInsideRoot(projectRoot: string, candidate: string): Promise<void> {
  const [realRoot, realCandidate] = await Promise.all([realpath(projectRoot), realpath(candidate)]);
  if (!isInsideRoot(realRoot, realCandidate)) throw new Error('Brief path must stay inside the project root');
}

export async function requireFlywheelBrief(cwd: string, requestedPath?: string): Promise<{ absolutePath: string; displayPath: string }> {
  const resolved = resolveFlywheelStartBriefPath(cwd, requestedPath);
  try {
    await assertExistingPathInsideRoot(cwd, resolved.absolutePath);
    await readFile(resolved.absolutePath, 'utf8');
    return resolved;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') throw new Error(`Flywheel brief not found: ${resolved.displayPath}`);
    throw error;
  }
}

/**
 * The flywheel is a project-scoped singleton: it must run from the PRIMARY
 * worktree root, never a linked feature worktree. Every worktree contains
 * docs/flywheel-brief.md, so the brief check alone cannot catch a caller whose
 * shell happens to sit inside a workspaces/feature-* checkout, and an
 * orchestrator spawned there operates inside a live work agent's worktree.
 * A linked worktree is
 * detected by `git rev-parse --git-common-dir` resolving to the primary's
 * .git directory; outside a repo (or on failure) the cwd is kept and the
 * brief check reports its own error.
 */

export async function resolvePrimaryWorktreeRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      'git rev-parse --path-format=absolute --git-common-dir',
      { cwd, timeout: 5000 },
    );
    const commonDir = stdout.trim();
    if (commonDir.endsWith(`${sep}.git`)) return dirname(commonDir);
    return cwd;
  } catch {
    return cwd;
  }
}
