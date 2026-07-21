let pending = false;

const listeners = new Set<() => void>();

export function requestRevealOpenQuestions(): void {
  pending = true;
  listeners.forEach((listener) => listener());
}

export function consumePendingReveal(): boolean {
  const wasPending = pending;
  pending = false;
  return wasPending;
}

export function subscribeRevealOpenQuestions(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
