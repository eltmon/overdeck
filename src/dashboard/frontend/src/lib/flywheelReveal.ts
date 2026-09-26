/**
 * The needs-you reveal channel (PAN-4199 WI-16; restored from the PAN-3917
 * cut, where it was `requestRevealOpenQuestions`).
 *
 * The app header's indicator and the Flywheel page live in different trees, so
 * "show me what needs me" cannot be a prop. The indicator sets a one-shot flag
 * and wakes every listener; the page consumes it, selects the Status tab, and
 * scrolls the needs-you block into view. The flag is one-shot on purpose — a
 * second page mounting later must not re-trigger a reveal nobody asked for.
 */
let pending = false;

const listeners = new Set<() => void>();

export function requestRevealNeedsYou(): void {
  pending = true;
  listeners.forEach((listener) => listener());
}

/** True at most once per request: reading it clears the flag. */
export function consumePendingReveal(): boolean {
  const wasPending = pending;
  pending = false;
  return wasPending;
}

export function subscribeRevealNeedsYou(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
