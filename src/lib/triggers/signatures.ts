/**
 * Webhook signature checks for triggers (PAN-4648 W-2).
 *
 * Both checks run over the exact raw request bytes, before anything else reads
 * the body, and compare digests with `timingSafeEqual` on equal-length buffers.
 *
 * - GitHub: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(secret, rawBody)>`.
 * - Stripe: `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]…`; the
 *   signed payload is `${t}.${rawBody}`, any matching `v1` passes (Stripe sends
 *   one per active secret while a secret rolls), and `t` must be within the
 *   tolerance of the server clock in both directions.
 *
 * This is new code on `Buffer`, separate from the CI webhook route's checker,
 * because `src/lib` never imports dashboard server code.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureCheck = { ok: true } | { ok: false; reason: 'missing' | 'mismatch' | 'stale' };

function equalStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyGitHubSignature(rawBody: Buffer, header: string | undefined, secret: string): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing' };
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return equalStrings(header, expected) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing' };
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const item of header.split(',')) {
    const separator = item.indexOf('=');
    if (separator === -1) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number.parseInt(value, 10);
    else if (key === 'v1') signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: 'missing' };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'stale' };
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest('hex');
  return signatures.some((signature) => equalStrings(signature, expected)) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
