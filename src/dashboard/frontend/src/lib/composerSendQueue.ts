/**
 * Per-conversation send queue (PAN-5184).
 *
 * The composer clears on Send and lets the operator send again at once, so
 * several POSTs for one conversation can be pending together. This chain runs
 * them one at a time, in the order they were enqueued: a task starts only after
 * every earlier task for the same conversation has settled. A rejected task
 * never blocks the ones behind it. With an empty queue a task starts
 * synchronously, so a single send keeps its old timing.
 *
 * Never enqueue from inside a running task for the same conversation: the inner
 * task waits for the outer one, which waits for the inner one.
 */
const tails = new Map<string, Promise<void>>();

export function enqueueConversationSend<T>(conversationName: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(conversationName);
  const run = previous ? previous.then(() => task()) : (async () => task())();
  const tail = run.then(() => undefined, () => undefined);
  tails.set(conversationName, tail);
  void tail.then(() => {
    if (tails.get(conversationName) === tail) tails.delete(conversationName);
  });
  return run;
}

/** Test-only: drop every pending tail. */
export function resetConversationSendQueues(): void {
  tails.clear();
}
