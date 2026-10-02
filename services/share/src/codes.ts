/**
 * Short room codes, host tokens and hashing on Web Crypto only (PRD PAN-658 "Codes").
 *
 * Randomness comes from the injected `Deps.randomBytes`, so tests control every code and token.
 */
import type { Deps } from './env.ts';

/** 28 symbols: no vowels (no accidental words), no 0/O or 1/I confusion. */
export const SHORT_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';
export const SHORT_CODE_LENGTH = 8;
/** 28 × 9: bytes at or above this are discarded so every symbol is equally likely. */
const REJECT_AT = Math.floor(256 / SHORT_CODE_ALPHABET.length) * SHORT_CODE_ALPHABET.length; // 252

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += (HEX[b >> 4] as string) + (HEX[b & 15] as string);
  return out;
}

/** 8 symbols drawn uniformly by rejection sampling over random bytes. */
export function newShortCode(deps: Pick<Deps, 'randomBytes'>): string {
  let out = '';
  while (out.length < SHORT_CODE_LENGTH) {
    for (const b of deps.randomBytes(16)) {
      if (b >= REJECT_AT) continue;
      out += SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length];
      if (out.length === SHORT_CODE_LENGTH) break;
    }
  }
  return out;
}

/** Uppercases and strips spaces and dashes; null unless exactly 8 alphabet symbols remain. */
export function normalizeShortCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]+/g, '');
  if (code.length !== SHORT_CODE_LENGTH) return null;
  for (const ch of code) if (!SHORT_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** The host's capability for a room: `odh_` + 64 hex (256 bits). Only its SHA-256 is stored. */
export function newHostToken(deps: Pick<Deps, 'randomBytes'>): string {
  return 'odh_' + toHex(deps.randomBytes(32));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

/** Constant-time comparison of two hex strings; false when the lengths differ. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
