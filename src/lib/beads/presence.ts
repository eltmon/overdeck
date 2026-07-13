import { createBeadsResolver } from './resolver.js';

/**
 * Bounded, event-loop-safe beads-presence snapshot.
 *
 * Performs one bulk resolver read over the canonical beads home (never per-workspace
 * sync `bd` calls — those block the event loop ~2s × ~30 dirs). Under bd lock
 * contention the `boundMs` timeout returns `{ known: false }` so callers degrade
 * instead of hanging.
 */
export async function issuesWithBeadsBounded(
  projectRoot: string,
  boundMs = 8_000,
): Promise<{ known: boolean; set: Set<string> }> {
  const set = new Set<string>();
  const all = await Promise.race([
    createBeadsResolver(projectRoot).getAllBeads(),
    new Promise<{ ok: false }>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false }), boundMs);
      timer.unref?.();
    }),
  ]);
  if (!all.ok) return { known: false, set };
  for (const bead of all.value) {
    for (const label of bead.labels ?? []) {
      if (/^[a-z]+-\d+$/i.test(label)) set.add(label.toUpperCase());
    }
  }
  return { known: true, set };
}
