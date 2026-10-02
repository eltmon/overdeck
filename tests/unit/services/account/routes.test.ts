import { describe, expect, it } from 'vitest';
import { HTML_CSP, HTML_REFERRER_POLICY } from '../../../../services/account/src/http.ts';
import { escapeHtml, errorPage, inviteOnlyPage, rateLimitedPage } from '../../../../services/account/src/pages.ts';
import { call, form, makeEnv } from './helpers/harness.ts';

const seen: Response[] = [];
async function track(p: Promise<Response>): Promise<Response> {
  const res = await p;
  seen.push(res);
  return res;
}

describe('account service route table (PAN-4293 account-scaffold)', () => {
  it('GET /healthz returns 200 with configured=true when every required value is set', async () => {
    const res = await track(call('GET', '/healthz'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true });
  });

  it('GET /healthz reports configured=false without revealing which value is missing', async () => {
    const res = await track(call('GET', '/healthz', { env: makeEnv({ GITHUB_CLIENT_SECRET: undefined }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: false });
  });

  it('an unknown path returns 404 not_found', async () => {
    const res = await track(call('GET', '/nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('a wrong method on a known path returns 405 with Allow listing the supported methods', async () => {
    const res = await track(call('POST', '/healthz'));
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');

    const multi = await track(call('GET', '/v1/devices/some-id'));
    expect(multi.status).toBe(405);
    expect(multi.headers.get('Allow')).toBe('PATCH, DELETE');
  });

  it('a malformed percent-encoded path parameter is 404, not a thrown URIError', async () => {
    for (const path of ['/v1/devices/%E0', '/admin/grants/%E0/revoke', '/admin/pending/%E0/allow']) {
      const res = await track(call('DELETE', path));
      expect(res.status, path).toBe(404);
    }
  });

  it('OPTIONS returns 405 on known and unknown paths', async () => {
    const known = await track(call('OPTIONS', '/v1/me'));
    expect(known.status).toBe(405);
    const unknown = await track(call('OPTIONS', '/nope'));
    expect(unknown.status).toBe(405);
  });

  it('missing GITHUB_CLIENT_SECRET makes /v1/me return 503 listing it while /healthz stays 200', async () => {
    const env = makeEnv({ GITHUB_CLIENT_SECRET: undefined });
    const me = await track(call('GET', '/v1/me', { env }));
    expect(me.status).toBe(503);
    expect(await me.json()).toEqual({ error: 'not_configured', missing: ['GITHUB_CLIENT_SECRET'] });

    const health = await track(call('GET', '/healthz', { env }));
    expect(health.status).toBe(200);
  });

  it('lists every missing required value and treats an empty string as missing', async () => {
    const env = makeEnv({ PUBLIC_BASE_URL: '', GITHUB_CLIENT_ID: undefined });
    const res = await track(call('GET', '/v1/me', { env }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured', missing: ['PUBLIC_BASE_URL', 'GITHUB_CLIENT_ID'] });
  });

  it('/admin* returns 503 listing OWNER_GITHUB_ID when it is unset or non-numeric; other routes are unaffected', async () => {
    for (const env of [makeEnv({ OWNER_GITHUB_ID: undefined }), makeEnv({ OWNER_GITHUB_ID: 'octocat' })]) {
      const admin = await track(call('GET', '/admin', { env }));
      expect(admin.status).toBe(503);
      expect(await admin.json()).toEqual({ error: 'not_configured', missing: ['OWNER_GITHUB_ID'] });

      const login = await track(call('POST', '/admin/login', { env, headers: { Origin: 'https://account.test' } }));
      expect(login.status).toBe(503);

      const me = await track(call('GET', '/v1/me', { env }));
      expect(me.status).toBe(401);
    }
  });

  it('configured routes reach their handlers', async () => {
    const res = await track(call('GET', '/v1/me'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_token' });

    const withParam = await track(call('POST', '/admin/grants/583231/revoke'));
    expect(withParam.status).toBe(200);
    expect(await withParam.text()).toContain('Sign in with GitHub');
  });

  it('POST /oauth/token with an unsupported grant_type returns 400 unsupported_grant_type', async () => {
    const res = await track(call('POST', '/oauth/token', form({ grant_type: 'password', username: 'x' })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unsupported_grant_type' });
  });

  it('POST /oauth/token without a form-encoded body returns 400 invalid_request', async () => {
    const res = await track(
      call('POST', '/oauth/token', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code' }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('POST /oauth/token dispatches the two supported grant types to their exchangers', async () => {
    const code = await track(call('POST', '/oauth/token', form({ grant_type: 'authorization_code' })));
    expect(code.status).toBe(400);
    expect(await code.json()).toEqual({ error: 'invalid_request' });
    const device = await track(
      call('POST', '/oauth/token', form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })),
    );
    expect(device.status).toBe(400);
    expect(await device.json()).toEqual({ error: 'invalid_request' });
  });

  it('a 17 KiB request body returns 413 before any handler runs', async () => {
    const big = form({ grant_type: 'authorization_code', pad: 'x'.repeat(17 * 1024) });
    const res = await track(call('POST', '/oauth/token', big));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('payload_too_large');

    const okSize = form({ grant_type: 'password', pad: 'x'.repeat(15 * 1024) });
    const small = await track(call('POST', '/oauth/token', okSize));
    expect(small.status).toBe(400);
  });

  it('JSON responses carry no-store and nosniff', async () => {
    const res = await track(call('GET', '/healthz'));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('HTML pages carry the D-28 Content-Security-Policy and companion headers', async () => {
    const pages = [errorPage(400, 'Bad parameter'), inviteOnlyPage(), rateLimitedPage(42)];
    for (const page of pages) {
      seen.push(page);
      expect(page.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(page.headers.get('Content-Security-Policy')).toBe(HTML_CSP);
      expect(page.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'",
      );
      expect(page.headers.get('X-Content-Type-Options')).toBe('nosniff');
      // Must stay `same-origin`: with `no-referrer` browsers send `Origin: null` on same-origin form POSTs,
      // and the /activate and /admin Origin checks would refuse the service's own forms.
      expect(page.headers.get('Referrer-Policy')).toBe('same-origin');
      expect(HTML_REFERRER_POLICY).toBe('same-origin');
      expect(page.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(pages[1]?.status).toBe(403);
    expect(await pages[1]?.text()).toContain('Overdeck accounts are invite-only right now.');
    expect(pages[2]?.status).toBe(429);
    expect(pages[2]?.headers.get('Retry-After')).toBe('42');
  });

  it('escapeHtml neutralises every HTML metacharacter', () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    );
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });

  it('no tested response carries an Access-Control-Allow-Origin header', () => {
    expect(seen.length).toBeGreaterThan(10);
    for (const res of seen) {
      expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false);
    }
  });
});
