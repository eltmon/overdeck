import { constants as fsConstants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Lexically resolve a pinned-doc path against the project root, returning
 * the project-relative path when it stays inside it. Returns null when the
 * resolved target escapes the root via an absolute path elsewhere on disk or
 * a `../` traversal.
 *
 * This check alone is NOT sufficient to gate storing or reading a pin: it
 * only inspects the path string, so an in-project symlink (e.g.
 * `docs/private -> ~/.ssh`) passes lexically while actually pointing outside
 * the project. Use `verifyPinPathContainment` for that — this function
 * remains exported for unpin, which only needs to compute the stored lookup
 * key and must keep working even if the underlying file no longer exists.
 */
export function resolveContainedPinPath(projectRoot: string, docPath: string): string | null {
  const absoluteRoot = resolve(projectRoot);
  const absoluteTarget = isAbsolute(docPath) ? resolve(docPath) : resolve(absoluteRoot, docPath);
  const rel = relative(absoluteRoot, absoluteTarget);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel;
}

/**
 * Symlink-safe containment check for storing (pin creation) or reading
 * (prompt-time injection) a pinned doc. Resolves the REAL path of both the
 * project root and the target — following any symlinks — and requires the
 * target to exist as a regular file inside the real root. A lexically
 * "contained" path can still escape the project if any path component is a
 * symlink; only realpath resolution catches that. Returns null (refuse) on
 * any escape, missing path, or non-regular-file target — never throws, so
 * callers can treat null uniformly as "don't pin/inject this".
 */
export async function verifyPinPathContainment(projectRoot: string, docPath: string): Promise<string | null> {
  const relativePath = resolveContainedPinPath(projectRoot, docPath);
  if (relativePath === null) return null;

  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = await realpath(resolve(projectRoot));
    realTarget = await realpath(resolve(projectRoot, relativePath));
  } catch {
    return null;
  }

  const relFromRealRoot = relative(realRoot, realTarget);
  if (relFromRealRoot === '' || relFromRealRoot.startsWith('..') || isAbsolute(relFromRealRoot)) return null;

  const info = await stat(realTarget).catch(() => null);
  if (!info || !info.isFile()) return null;

  return relativePath;
}

/**
 * Symlink-safe containment check AND read, combined into a single verified
 * file descriptor. verifyPinPathContainment (path-in, path-out) still leaves
 * a time-of-check/time-of-use gap for a caller that separately re-opens the
 * path afterward — a concurrent local process could retarget a symlink in
 * between (review fix, cycle 3 non-blocking). This opens the realpath-
 * resolved (symlink-free) target once, verifies it's a regular file via
 * `fstat` on that SAME open handle, and reads from that SAME handle — no
 * second path-based lookup exists for anything to race. Returns null on any
 * escape, missing path, or non-regular-file target, exactly like
 * verifyPinPathContainment.
 *
 * Review fix (cycle 4 non-blocking): `realTarget` is still a pathname, and a
 * concurrent local writer could replace its final component with a symlink
 * between the `realpath()` call and this `open()` call. O_NOFOLLOW makes
 * that race fail closed instead of silently following the swapped-in
 * symlink — `open` errors (caught below, returns null) rather than
 * succeeding on an attacker-controlled target. This does not protect
 * replaceable PARENT directory components (a full openat-style walk would),
 * which is why this remains a narrowed, not eliminated, advisory.
 */
export async function readVerifiedPinFile(projectRoot: string, docPath: string): Promise<string | null> {
  const relativePath = resolveContainedPinPath(projectRoot, docPath);
  if (relativePath === null) return null;

  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = await realpath(resolve(projectRoot));
    realTarget = await realpath(resolve(projectRoot, relativePath));
  } catch {
    return null;
  }

  const relFromRealRoot = relative(realRoot, realTarget);
  if (relFromRealRoot === '' || relFromRealRoot.startsWith('..') || isAbsolute(relFromRealRoot)) return null;

  let handle;
  try {
    handle = await open(realTarget, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) return null;
    return await handle.readFile('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}
