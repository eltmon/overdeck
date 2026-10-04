/**
 * PAN-4543: DoD row 8's /api/health probe, retried across a short server stall.
 *
 * The dashboard event loop can stall for 4-5 s right after a close-out, so a
 * single probe turns a live, deployed fix into a false `dashboard not
 * reachable` miss. Any rejection (timeout, connection refused, 5xx) counts as a
 * failed attempt; only all attempts failing is the real signal.
 */
export const DEPLOY_PROBE_ATTEMPTS = 3;
export const DEPLOY_PROBE_TIMEOUT_MS = 5000;
export const DEPLOY_PROBE_PAUSE_MS = 2000;

export async function readHealthWithRetry(
  readJson: (url: string) => Promise<Record<string, unknown>>,
  url: string,
): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DEPLOY_PROBE_ATTEMPTS; attempt++) {
    try {
      return await readJson(url);
    } catch (error) {
      lastError = error;
      if (attempt < DEPLOY_PROBE_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, DEPLOY_PROBE_PAUSE_MS));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`after ${DEPLOY_PROBE_ATTEMPTS} attempts: ${message}`);
}
