import { createBeadsResolver, type BeadRecord, type BeadsReadResult } from './resolver.js';
import { resolveCanonicalBeadsHome } from './home.js';

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
    readAllBeadsCached(projectRoot),
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

// ─── Cached bulk snapshot (request-driven readers) ───────────────────────────

/**
 * TTL for the cached all-beads snapshot. Request-driven per-issue readers
 * (e.g. the dashboard BeadsRail polls /api/issues/:id/beads every 10s per
 * open issue) share ONE bd process per store per TTL window instead of
 * spawning one per request. Staleness is bounded by the rail's own poll
 * cadence, so the UI converges within one refetch.
 */
const ALL_BEADS_SNAPSHOT_TTL_MS = 10_000;

type SnapshotEntry = { at: number; result: BeadsReadResult<BeadRecord[]> };
const snapshotCache = new Map<string, SnapshotEntry>();
const snapshotInFlight = new Map<string, Promise<BeadsReadResult<BeadRecord[]>>>();

/** Drop cached snapshots (all stores). Call after a beads mutation lands, or from tests. */
export function clearBeadsSnapshotCache(): void {
  snapshotCache.clear();
}

/** Cache key: the canonical beads store, so every workspace of a project shares one snapshot. */
function snapshotKey(dir: string): string {
  try {
    return resolveCanonicalBeadsHome(dir) ?? dir;
  } catch {
    return dir;
  }
}

/**
 * All beads from the store `dir` resolves to, served from a short-TTL cache
 * with in-flight dedupe. Failures are cached for the same TTL — a contended
 * bd lock must not let per-request retries re-create the process storm.
 */
export async function readAllBeadsCached(dir: string): Promise<BeadsReadResult<BeadRecord[]>> {
  const key = snapshotKey(dir);
  const cached = snapshotCache.get(key);
  if (cached && Date.now() - cached.at < ALL_BEADS_SNAPSHOT_TTL_MS) return cached.result;

  const inFlight = snapshotInFlight.get(key);
  if (inFlight) return inFlight;

  const read = createBeadsResolver(dir)
    .getAllBeads()
    .then((result) => {
      snapshotCache.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => {
      snapshotInFlight.delete(key);
    });
  snapshotInFlight.set(key, read);
  return read;
}

/** Beads carrying `issueId` as a label, filtered from the cached bulk snapshot. */
export async function readBeadsForIssueCached(
  dir: string,
  issueId: string,
): Promise<BeadsReadResult<BeadRecord[]>> {
  const all = await readAllBeadsCached(dir);
  if (!all.ok) return all;
  const wanted = issueId.toLowerCase();
  return { ok: true, value: all.value.filter((bead) => (bead.labels ?? []).some((l) => l.toLowerCase() === wanted)) };
}
