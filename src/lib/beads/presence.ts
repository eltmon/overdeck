import { createBeadsResolver } from './resolver.js';

/**
 * Bulk beads-presence snapshot: which issues have at least one bead.
 *
 * Post-PAN-2564 every `bd` invocation pays a ~2s embedded-Dolt startup, so
 * per-issue presence checks (one `bd list -l <issue>` per issue/workspace)
 * multiply into minutes of CPU and a permanently contended bd process lock.
 * Long-running processes (dashboard, deacon) MUST derive presence from ONE
 * bulk read per project pass via this helper instead of querying per issue.
 */
export interface BeadsPresence {
  /** false when the bulk read failed or timed out — callers degrade instead of hanging */
  known: boolean;
  /** uppercase issue IDs (e.g. "PAN-1234") that have at least one bead */
  set: ReadonlySet<string>;
}

const DEFAULT_TIMEOUT_MS = 8_000;

const ISSUE_LABEL_RE = /^[a-z]+-\d+$/i;

/**
 * One bulk resolver read → the set of issue IDs with beads. Bounded: under bd
 * lock contention the timeout returns { known: false } so callers degrade
 * instead of hanging (mirrors the backlog routes' NFR-2 behavior).
 */
export async function readIssuesWithBeads(
  projectRoot: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<BeadsPresence> {
  const set = new Set<string>();
  const all = await Promise.race([
    createBeadsResolver(projectRoot).getAllBeads(),
    new Promise<{ ok: false }>((resolve) => {
      setTimeout(() => resolve({ ok: false }), timeoutMs).unref?.();
    }),
  ]);
  if (!all.ok) return { known: false, set };
  for (const bead of all.value) {
    for (const label of bead.labels ?? []) {
      if (ISSUE_LABEL_RE.test(label)) set.add(label.toUpperCase());
    }
  }
  return { known: true, set };
}
