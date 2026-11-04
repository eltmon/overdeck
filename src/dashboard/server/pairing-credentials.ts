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
 *
 * PAN-4645 (D-4645-17): the same credential also pairs a machine. Its pairing
 * id and Noise pre-shared key are derived from the code at issue time;
 * `takePairingById` hands the PSK to the secure-channel listener and consumes
 * the credential, so whichever side (browser device or machine) uses a code
 * first wins and a second use is `unknown`.
 */
import { createHash, randomBytes } from 'node:crypto';

import { pairingSecrets } from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';

export const PAIRING_CREDENTIAL_PREFIX = 'odp_';
export const PAIRING_CREDENTIAL_TTL_MS = 10 * 60_000;
const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES = 10;

export type PairingConsumeResult = 'ok' | 'expired' | 'unknown';

interface PendingCredential {
  /** Epoch ms. Expired entries are kept one extra TTL so they answer `expired`. */
  expiresAt: number;
  /** Noise XXpsk0 pre-shared key (D-4645-17). */
  psk: Uint8Array;
  /** 32 hex characters; the initiator sends it in the channel preamble. */
  pairingId: string;
}

/** Credential hash → entry. */
const pending = new Map<string, PendingCredential>();
/** Pairing id → credential hash. */
const byPairingId = new Map<string, string>();
let failures: number[] = [];
let lockedUntil = 0;

function hashCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

function remove(hash: string): PendingCredential | undefined {
  const entry = pending.get(hash);
  if (entry) {
    pending.delete(hash);
    byPairingId.delete(entry.pairingId);
  }
  return entry;
}

function prune(now: number): void {
  for (const [hash, entry] of pending) {
    if (now > entry.expiresAt + PAIRING_CREDENTIAL_TTL_MS) remove(hash);
  }
}

export function issuePairingCredential(): { credential: string; expiresAt: string } {
  const now = Date.now();
  prune(now);
  const credential = `${PAIRING_CREDENTIAL_PREFIX}${randomBytes(32).toString('hex')}`;
  const expiresAt = now + PAIRING_CREDENTIAL_TTL_MS;
  const { psk, pairingId } = pairingSecrets(nodeCrypto, credential);
  const hash = hashCredential(credential);
  pending.set(hash, { expiresAt, psk, pairingId });
  byPairingId.set(pairingId, hash);
  return { credential, expiresAt: new Date(expiresAt).toISOString() };
}

/** Consume a credential. Any outcome removes it, so a second attempt is `unknown`. */
export function consumePairingCredential(credential: string): PairingConsumeResult {
  const now = Date.now();
  const entry = remove(hashCredential(credential));
  prune(now);
  if (entry === undefined) return 'unknown';
  return now > entry.expiresAt ? 'expired' : 'ok';
}

/**
 * Hand the PSK behind a pairing id to the secure-channel listener and consume
 * the credential (PAN-4645 D-4645-17). Any outcome removes it.
 */
export function takePairingById(pairingId: string): { psk: Uint8Array } | 'expired' | 'unknown' {
  const now = Date.now();
  const hash = byPairingId.get(pairingId);
  const entry = hash === undefined ? undefined : remove(hash);
  prune(now);
  if (entry === undefined) return 'unknown';
  return now > entry.expiresAt ? 'expired' : { psk: entry.psk };
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
  byPairingId.clear();
  failures = [];
  lockedUntil = 0;
}
