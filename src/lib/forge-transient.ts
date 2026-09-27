/**
 * Transient forge failures (PAN-4263).
 *
 * A forge lookup that fails for a reason that can succeed on retry — a rate
 * limit, a network blip, a 502/503/504 — must not read as "no PR". This module
 * names those failures and retries an operation through them with backoff.
 */

/**
 * The status-code alternative is anchored to how the clients format it
 * (`githubApiWithToken` throws `… failed: 503 <text>`; gh prints `HTTP 502: …`),
 * so a PR number such as `/pull/504` inside a message never classifies as transient.
 */
const TRANSIENT_FORGE_ERROR =
  /rate limit|secondary rate|abuse detection|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|timed out|(?:failed: |HTTP )50[234]\b/i;

/** True when `err` (an Error, a string, or an exec error with `stderr`) is a transient forge failure. */
export function isTransientForgeError(err: unknown): boolean {
  if (typeof err === 'string') return TRANSIENT_FORGE_ERROR.test(err);
  if (err && typeof err === 'object') {
    const { message, stderr } = err as { message?: unknown; stderr?: unknown };
    return TRANSIENT_FORGE_ERROR.test(`${String(message ?? '')}\n${String(stderr ?? '')}`);
  }
  return false;
}

/**
 * Run `op`, retrying only transient forge failures after each delay in
 * `delaysMs` (3 attempts total by default: 2 s, then 8 s). A non-transient
 * error, or the last transient one, is rethrown unchanged.
 */
export async function retryTransientForgeOp<T>(
  op: () => Promise<T>,
  delaysMs: readonly number[] = [2000, 8000],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      const delayMs = delaysMs[attempt];
      if (delayMs === undefined || !isTransientForgeError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
