/**
 * One-time pairing credentials (PAN-3762 D-3762-5, D-3762-6).
 *
 * `pan pair` asks the dashboard for an `odp_<64 hex>` credential; another
 * device exchanges it once for its own revocable `odk_` device token. The
 * credential lives only in this process's memory as a SHA-256 hash, is single
 * use, and expires 10 minutes after issue. A dashboard restart drops every
 * outstanding credential.
 *
 * The exchange route is unauthenticated, so failed exchanges are rate limited
 * process-wide: after 10 failures within 60 s, exchanges answer 429 for 60 s.
 */
import { createHash, randomBytes } from 'node:crypto';

export const PAIRING_CREDENTIAL_PREFIX = 'odp_';
export const PAIRING_CREDENTIAL_TTL_MS = 10 * 60_000;
const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES = 10;

export type PairingConsumeResult = 'ok' | 'expired' | 'unknown';

/** Hash → expiry (epoch ms). Expired entries are kept one extra TTL so they answer `expired`. */
const pending = new Map<string, number>();
let failures: number[] = [];
let lockedUntil = 0;

function hashCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

function prune(now: number): void {
  for (const [hash, expiresAt] of pending) {
    if (now > expiresAt + PAIRING_CREDENTIAL_TTL_MS) pending.delete(hash);
  }
}

export function issuePairingCredential(): { credential: string; expiresAt: string } {
  const now = Date.now();
  prune(now);
  const credential = `${PAIRING_CREDENTIAL_PREFIX}${randomBytes(32).toString('hex')}`;
  const expiresAt = now + PAIRING_CREDENTIAL_TTL_MS;
  pending.set(hashCredential(credential), expiresAt);
  return { credential, expiresAt: new Date(expiresAt).toISOString() };
}

/** Consume a credential. Any outcome removes it, so a second attempt is `unknown`. */
export function consumePairingCredential(credential: string): PairingConsumeResult {
  const now = Date.now();
  const hash = hashCredential(credential);
  const expiresAt = pending.get(hash);
  pending.delete(hash);
  prune(now);
  if (expiresAt === undefined) return 'unknown';
  return now > expiresAt ? 'expired' : 'ok';
}

export function isPairingExchangeRateLimited(): boolean {
  return Date.now() < lockedUntil;
}

/** Count one failed exchange; the 10th within 60 s locks exchanges for 60 s. */
export function recordPairingExchangeFailure(): void {
  const now = Date.now();
  failures = failures.filter((at) => now - at < FAILURE_WINDOW_MS);
  failures.push(now);
  if (failures.length >= MAX_FAILURES) {
    lockedUntil = now + FAILURE_WINDOW_MS;
    failures = [];
  }
}

/** Test-only: forget every credential and the rate-limit window. */
export function _resetPairingCredentialsForTests(): void {
  pending.clear();
  failures = [];
  lockedUntil = 0;
}
