/**
 * Machine key fingerprint with WebCrypto: the first 10 bytes of SHA-256 over the raw 32-byte key,
 * as five dash-separated groups of four lowercase hex characters. Same rule as
 * `machineKeyFingerprint` in src/lib/anywhere/machine-key.ts.
 */
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export async function keyFingerprint(publicKeyHex: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', hexToBytes(publicKeyHex)));
  const hex = bytesToHex(digest.subarray(0, 10));
  return [0, 4, 8, 12, 16].map((offset) => hex.slice(offset, offset + 4)).join('-');
}
