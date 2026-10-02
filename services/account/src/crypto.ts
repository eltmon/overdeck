/**
 * Randomness and hashing on Web Crypto only (PRD PAN-4293 D-5, D-6).
 * Every secret carries fresh randomness from crypto.getRandomValues, so SHA-256 at rest is the right hash.
 */

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

/** `bytes` random bytes as lowercase hex (2 × bytes characters). */
export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 S256: base64url (no padding) of SHA-256 over the ASCII verifier. */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Unambiguous consonants: no vowels (no accidental words), no 0/O, 1/I/L confusion. */
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const USER_CODE_LENGTH = 8;

/** 8 letters from the 20-letter alphabet, uniform via rejection sampling (bytes ≥ 240 are discarded). */
export function userCode(): string {
  const limit = Math.floor(256 / USER_CODE_ALPHABET.length) * USER_CODE_ALPHABET.length; // 240
  let out = '';
  while (out.length < USER_CODE_LENGTH) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= limit) continue;
      out += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
      if (out.length === USER_CODE_LENGTH) break;
    }
  }
  return out;
}
