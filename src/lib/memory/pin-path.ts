import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Resolve a pinned-doc path against the project root and verify it stays
 * inside it, returning the project-relative path on success. Returns null
 * when the resolved target escapes the root — via an absolute path elsewhere
 * on disk or a `../` traversal — so a pin can never read arbitrary local
 * files (e.g. `~/.ssh/id_rsa`) into prompt-time context sent to the
 * configured model provider (PAN-1990 review: memory.ts pin creation and
 * injection.ts's read must both call this).
 */
export function resolveContainedPinPath(projectRoot: string, docPath: string): string | null {
  const absoluteRoot = resolve(projectRoot);
  const absoluteTarget = isAbsolute(docPath) ? resolve(docPath) : resolve(absoluteRoot, docPath);
  const rel = relative(absoluteRoot, absoluteTarget);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel;
}
