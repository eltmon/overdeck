import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, PUSH_FETCH_TIMEOUT_MS } from '../../../../../services/connect/src/push/http.ts';
import { base64UrlBytes, base64UrlJson, pemToDer, signingInput } from '../../../../../services/connect/src/push/jwt.ts';

function toPem(der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
}

describe('push JWT helpers (PAN-4830 WI-3)', () => {
  it('encodes base64url without padding', () => {
    expect(base64UrlBytes(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(base64UrlBytes(new Uint8Array([]))).toBe('');
    expect(base64UrlJson({ alg: 'ES256' })).toBe('eyJhbGciOiJFUzI1NiJ9');
  });

  it('builds the signing input from header and claims', () => {
    expect(signingInput({ alg: 'ES256' }, { iat: 1 })).toBe('eyJhbGciOiJFUzI1NiJ9.eyJpYXQiOjF9');
  });

  it('round-trips a runtime-generated PKCS#8 key through PEM', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    expect(pemToDer(toPem(der))).toEqual(new Uint8Array(der));
  });
});

describe('fetchWithTimeout (PAN-4830 WI-3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects after 2,000 ms when the fetch never answers, and aborts it', async () => {
    let signal: AbortSignal | undefined;
    const never: typeof fetch = (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    };
    const pending = fetchWithTimeout(never, 'https://push.test/', { method: 'POST' });
    const settled = vi.fn();
    pending.then(settled, settled);
    await vi.advanceTimersByTimeAsync(PUSH_FETCH_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toThrow('timeout');
    expect(signal?.aborted).toBe(true);
  });

  it('resolves with the response when the stub answers first', async () => {
    const answer = new Response('ok', { status: 200 });
    const stub: typeof fetch = async () => answer;
    await expect(fetchWithTimeout(stub, 'https://push.test/', {})).resolves.toBe(answer);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the network error when the fetch throws', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('network down');
    };
    await expect(fetchWithTimeout(failing, 'https://push.test/', {})).rejects.toThrow('network down');
  });
});
