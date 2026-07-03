const issueRecordLocks = new Map<string, Promise<void>>();

/**
 * Serialize async read-modify-write rebuilds for a single issue record.
 *
 * Synchronous record writers remain synchronous; async flows that read, await,
 * then write the whole record must use this lock so same-issue rebuilds cannot
 * overwrite each other's final re-read.
 */
export async function withIssueRecordLock<T>(
  issueId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const key = issueId.toUpperCase();
  const previous = issueRecordLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => undefined).then(() => current);
  issueRecordLocks.set(key, chain);

  await previous.catch(() => undefined);

  try {
    return await fn();
  } finally {
    release();
    if (issueRecordLocks.get(key) === chain) {
      issueRecordLocks.delete(key);
    }
  }
}
