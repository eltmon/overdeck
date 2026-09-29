/**
 * Shared cwd containment check for conversation-forks.ts and
 * conversation-runtime.ts (PAN-4338, collapsing two identical copies).
 *
 * This only validates that a cwd is a real, absolute directory under the
 * user's home — it does not check for a project's primary checkout.
 * conversation-runtime.ts's callers validate an *existing* conversation's
 * recorded cwd and must keep accepting a primary checkout there.
 */
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';

/** Validate a caller-supplied cwd is an existing directory under the user's home. */
export async function validateCwdContainment(cwd: string): Promise<boolean> {
  if (!cwd.startsWith('/')) return false;
  const segments = cwd.split('/').filter(Boolean);
  if (segments.includes('..')) return false;
  try {
    const resolved = await realpath(cwd);
    const stats = await stat(resolved);
    if (!stats.isDirectory()) return false;
    const home = homedir();
    return resolved.startsWith(`${home}/`) || resolved === home;
  } catch {
    return false;
  }
}
