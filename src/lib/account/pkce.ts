/**
 * PKCE helpers for the account service's loopback browser sign-in (PAN-4960, RFC 7636).
 *
 * The dashboard server creates the verifier and keeps it; only the S256 challenge goes into
 * the authorize URL. This module imports only Node built-ins so `pan account` stays light.
 */

import { createHash, randomBytes } from 'node:crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** 32 random bytes as base64url (43 chars) and its S256 challenge. */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: s256(verifier) };
}

/** RFC 7636 S256: base64url (no padding) of SHA-256 of the verifier's ASCII bytes. */
export function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** 16 random bytes as hex. */
export function createSignInState(): string {
  return randomBytes(16).toString('hex');
}

/** `<baseUrl>/auth/start?…` for the PKCE loopback flow. */
export function authorizeUrl(
  baseUrl: string,
  p: { redirectUri: string; state: string; challenge: string; platform: string; environmentId: string },
): string {
  const q = new URLSearchParams({
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    platform: p.platform,
    environment_id: p.environmentId,
  });
  return `${baseUrl}/auth/start?${q.toString()}`;
}
