/**
 * PAN-4506. The terminal backend answers a kickoff delivery with
 * `{ ok: false, failure: 'invalid_request: …' }` when it rejected the
 * request outright (malformed wire payload) rather than merely declining to
 * deliver it (e.g. a permission guard). spawnRun must fail loudly on the
 * former — today it silently discards the ok:false result for non-kimi-code
 * harnesses, leaving the reviewer idle while the stall detector re-dispatches
 * the same doomed text forever.
 */

export class KickoffRejectedError extends Error {
  readonly failure: string;

  constructor(agentId: string, failure: string) {
    super(`Agent ${agentId} kickoff rejected by the terminal backend: ${failure}`);
    this.name = 'KickoffRejectedError';
    this.failure = failure;
  }
}

export function isRejectedKickoffFailure(failure: string | undefined): boolean {
  return typeof failure === 'string' && failure.startsWith('invalid_request:');
}

export function isKickoffRejection(error: unknown): boolean {
  return error instanceof KickoffRejectedError;
}
