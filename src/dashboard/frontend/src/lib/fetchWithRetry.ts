/**
 * Fetch with automatic retry on network errors (PAN-207)
 *
 * Docker network operations during workspace creation/container startup
 * can cause net::ERR_NETWORK_CHANGED, which manifests as TypeError: Failed to fetch.
 * This wrapper retries on such transient network errors with exponential backoff.
 */

const RETRY_DELAYS = [1000, 2000, 4000]; // 3 retries: 1s, 2s, 4s

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed');
  }
  return false;
}

/**
 * Fetch with retry on network errors.
 * Same signature as window.fetch — drop-in replacement.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await fetch(input, init);
      return response;
    } catch (error) {
      lastError = error;

      // Only retry on network errors, not other failures
      if (!isNetworkError(error) || attempt >= RETRY_DELAYS.length) {
        throw error;
      }

      const delay = RETRY_DELAYS[attempt];
      console.warn(
        `[fetchWithRetry] Network error on attempt ${attempt + 1}, retrying in ${delay}ms:`,
        error instanceof Error ? error.message : error
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
