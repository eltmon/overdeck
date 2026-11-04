/**
 * PAN-4648 W-2: GitHub and Stripe signature checks over raw bytes, pinned to
 * GitHub's documented example and a computed Stripe vector.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyGitHubSignature, verifyStripeSignature } from '../../../../src/lib/triggers/signatures.js';

describe('verifyGitHubSignature (PAN-4648)', () => {
  const secret = "It's a Secret to Everybody";
  const body = Buffer.from('Hello, World!');
  const header = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';

  it("accepts GitHub's documented example", () => {
    expect(verifyGitHubSignature(body, header, secret)).toEqual({ ok: true });
  });

  it('rejects a changed digest as a mismatch', () => {
    const changed = `${header.slice(0, -1)}${header.endsWith('7') ? '8' : '7'}`;
    expect(verifyGitHubSignature(body, changed, secret)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('reports a missing header and treats a short header as a mismatch', () => {
    expect(verifyGitHubSignature(body, undefined, secret)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyGitHubSignature(body, 'sha256=abc', secret)).toEqual({ ok: false, reason: 'mismatch' });
  });
});

describe('verifyStripeSignature (PAN-4648)', () => {
  const secret = 'whsec_test_secret';
  const t = 1_700_000_000;
  const body = Buffer.from('{"id":"evt_1","type":"payment_intent.succeeded"}');
  const v1 = createHmac('sha256', secret).update(`${t}.${body.toString('utf8')}`).digest('hex');

  it('accepts a valid signature inside the tolerance', () => {
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, 1_700_000_100)).toEqual({ ok: true });
  });

  it('accepts when an unrelated v1 comes before the matching one', () => {
    expect(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)},v1=${v1}`, secret, 1_700_000_100)).toEqual({ ok: true });
  });

  it('rejects stale and future timestamps', () => {
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, 1_700_000_301)).toEqual({ ok: false, reason: 'stale' });
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, 1_699_999_699)).toEqual({ ok: false, reason: 'stale' });
  });

  it('reports missing when there is no v1, no t, or no header', () => {
    expect(verifyStripeSignature(body, `t=${t},v0=${v1}`, secret, 1_700_000_100)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyStripeSignature(body, `v1=${v1}`, secret, 1_700_000_100)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyStripeSignature(body, undefined, secret, 1_700_000_100)).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a signature from a different secret as a mismatch', () => {
    const wrong = createHmac('sha256', 'whsec_other').update(`${t}.${body.toString('utf8')}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${t},v1=${wrong}`, secret, 1_700_000_100)).toEqual({ ok: false, reason: 'mismatch' });
  });
});
