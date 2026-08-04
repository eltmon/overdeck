const listeners = new Set<() => void>();

export function subscribeProjectsConfigInvalidation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyProjectsConfigInvalidated(): void {
  for (const listener of listeners) listener();
}
