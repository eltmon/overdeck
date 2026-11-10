/**
 * PAN-5111: operator answer notes for the push history (D-6, D-7).
 *
 * An Overdeck answer door calls `noteOperatorAnswer('auq:<toolUseId>')` after it
 * verified the pending question and delivered the operator's answer. The push
 * dispatcher later asks `operatorAnsweredBetween(key, from, to)` to decide whether a
 * departed pushed key resolves `answered`. Notes are timestamps, never consumed, so a
 * repeated key cannot take another push's note.
 *
 * Memory only and bounded: at most 10 times per key, 500 keys, and 24 h of age.
 * Lives in `src/lib/push/` so `src/lib/overdeck/` handlers can import it without
 * importing dashboard server code.
 */

const MAX_TIMES_PER_KEY = 10;
const MAX_KEYS = 500;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** key → note times, oldest first. Map order is insertion order, used for key eviction. */
const notes = new Map<string, number[]>();

function prune(now: number): void {
  const cutoff = now - MAX_AGE_MS;
  for (const [key, times] of notes) {
    const kept = times.filter((t) => t >= cutoff);
    if (kept.length === 0) notes.delete(key);
    else if (kept.length !== times.length) notes.set(key, kept);
  }
}

/** Record that the operator answered pending key `key` (e.g. `auq:toolu_01…`) through Overdeck at `now`. */
export function noteOperatorAnswer(key: string, now: number = Date.now()): void {
  if (!key) return;
  prune(now);
  const times = notes.get(key);
  if (times) {
    times.push(now);
    if (times.length > MAX_TIMES_PER_KEY) times.splice(0, times.length - MAX_TIMES_PER_KEY);
    return;
  }
  notes.set(key, [now]);
  while (notes.size > MAX_KEYS) {
    const oldest = notes.keys().next().value;
    if (oldest === undefined) break;
    notes.delete(oldest);
  }
}

/** True when a note for `key` has a time in [fromMs, toMs]. Never consumes the note (D-7). */
export function operatorAnsweredBetween(key: string, fromMs: number, toMs: number, now: number = Date.now()): boolean {
  prune(now);
  if (!key) return false;
  return (notes.get(key) ?? []).some((t) => t >= fromMs && t <= toMs);
}

/** Tests only. */
export function resetOperatorAnswers(): void {
  notes.clear();
}
