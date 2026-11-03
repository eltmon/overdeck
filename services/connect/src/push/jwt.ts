/**
 * JWT and PEM helpers for the push providers (PRD PAN-4830 WI-3, D-16). Web APIs only.
 *
 * The APNs provider token (ES256) and the FCM service-account assertion (RS256) are both
 * `<base64url header>.<base64url claims>.<base64url signature>`; apns.ts and fcm.ts sign the input.
 */

/** Unpadded base64url (RFC 7515 §2). */
export function base64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64url with or without padding (a JWK's `d`, for instance). */
export function base64UrlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

/** The DER bytes of a PEM block: the `-----…-----` lines and all whitespace dropped, then base64-decoded. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** `<base64url header>.<base64url claims>`, the bytes a JWS signature covers. */
export function signingInput(header: object, claims: object): string {
  return `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
}
