import { AsyncLocalStorage } from 'node:async_hooks';

const reviewLifecycleTails = new Map<string, Promise<void>>();
const heldReviewLifecycles = new AsyncLocalStorage<ReadonlySet<string>>();

/** Return the issue owned by a review parent or convoy member agent id. */
export function reviewIssueIdForAgent(agentId: string): string | null {
  const match = /^agent-([a-z]+-\d+)-review(?:-|$)/i.exec(agentId);
  return match?.[1]?.toUpperCase() ?? null;
}

/**
 * Serialize review-family lifecycle mutations for one issue.
 *
 * Dispatch owns this guard across stop, state wipe, and replacement spawn.
 * Direct review-family resumes enter through the same guard. Calls made by a
 * guarded dispatch are re-entrant because dispatch legitimately warm-resumes
 * the parent and convoy members while it owns the replacement sequence.
 */
export async function withReviewLifecycleGuard<T>(
  issueId: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  const key = issueId.toUpperCase();
  const held = heldReviewLifecycles.getStore();
  if (held?.has(key)) return operation();

  const previous = reviewLifecycleTails.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  reviewLifecycleTails.set(key, tail);

  await previous.catch(() => undefined);
  try {
    const nextHeld = new Set(held);
    nextHeld.add(key);
    return await heldReviewLifecycles.run(nextHeld, operation);
  } finally {
    release();
    if (reviewLifecycleTails.get(key) === tail) reviewLifecycleTails.delete(key);
  }
}

/** Run review-family agents under their issue guard; leave other agents alone. */
export async function withReviewLifecycleGuardForAgent<T>(
  agentId: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  const issueId = reviewIssueIdForAgent(agentId);
  return issueId ? withReviewLifecycleGuard(issueId, operation) : operation();
}
