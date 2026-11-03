/**
 * The `/s/:code` landing page (PRD PAN-658 "HTTP API"). Inline CSS only.
 *
 * The page never shows room data: no host name, scope or participant count. It only tells the
 * invitee how to join from their own Overdeck. routes.ts adds `Cache-Control` and `nosniff`.
 *
 * PAN-4475 (D-14): the invite page carries one nonce'd inline script that probes the local
 * dashboard (`GET /api/share-probe` on `LOCAL_DASHBOARD_ORIGINS`) and navigates to
 * `<origin>/#/shared/<CODE>` when it answers. The manual link and `pan up` instructions always
 * show. The 404 page keeps `HTML_CSP` and has no script. `pan join` returns in slice 9 (PAN-4480).
 *
 * PAN-4481 (FR-11): when web join is configured, the page also carries a hidden `#web-join` section
 * that `/viewer/viewer.js` fills, and the probe stops navigating once a browser join started.
 */

export const HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";
export const INSTALL_DOCS_URL = 'https://docs.overdeck.ai/quickstart';
/** The default `dashboard.api_port`; a dashboard on another port uses the manual link. */
export const LOCAL_DASHBOARD_ORIGINS = ['http://localhost:3011', 'http://127.0.0.1:3011'] as const;

/** Web join is configured: the page loads the hosted viewer from this origin. */
export interface HostedWeb {
  /** No trailing slash. */
  publicBaseUrl: string;
}

/** The share origin as a WebSocket origin: `https:` → `wss:`, or `http:` → `ws:` for local development. */
function webSocketOrigin(publicBaseUrl: string): string {
  return publicBaseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

export function invitePageCsp(nonce: string, web: HostedWeb | null = null): string {
  if (!web) {
    return `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${LOCAL_DASHBOARD_ORIGINS.join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  }
  return (
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'nonce-${nonce}'; ` +
    `connect-src 'self' ${webSocketOrigin(web.publicBaseUrl)} ${LOCAL_DASHBOARD_ORIGINS.join(' ')}; ` +
    `img-src https://avatars.githubusercontent.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  );
}

/**
 * Pages with our own forms send `same-origin`, not `no-referrer`: under `no-referrer` the Fetch Standard
 * serializes the Origin of a same-origin form POST as `null`, so the Sign out form would fail the
 * `POST /auth/signout` Origin check (the account Worker hit the same thing; see HTML_REFERRER_POLICY in
 * services/account/src/http.ts). `same-origin` still sends no Referer to github.com or account.overdeck.ai.
 */
export type ReferrerPolicy = 'no-referrer' | 'same-origin';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.15rem; }
  code { font: 1.1rem/1.4 ui-monospace, monospace; padding: 0.2rem 0.4rem; border: 1px solid #8884; }
  #web-join { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #8884; }
  .controls { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
  .button { font: inherit; display: inline-block; padding: 0.35rem 0.9rem; border: 1px solid #8888; border-radius: 0.3rem; background: transparent; color: inherit; text-decoration: none; cursor: pointer; }
  .button.secondary { opacity: 0.8; }
  form.inline { display: inline; margin: 0; }
  .avatar { width: 24px; height: 24px; border-radius: 0.25rem; vertical-align: middle; }
  .roster { list-style: none; display: flex; flex-wrap: wrap; gap: 0.75rem; padding: 0; margin: 0 0 1rem; }
  .roster li { display: flex; align-items: center; gap: 0.35rem; }
  .tag { font-size: 0.75rem; padding: 0 0.3rem; border: 1px solid #8888; border-radius: 0.2rem; }
  .banner, .notice { padding: 0.4rem 0.6rem; border: 1px solid #8886; border-radius: 0.3rem; font-size: 0.9rem; }
  .messages { list-style: none; padding: 0; margin: 0; }
  .message { padding: 0.6rem 0; border-bottom: 1px solid #8883; }
  .message .role { font-size: 0.8rem; font-weight: 600; opacity: 0.75; }
  .message .text { white-space: pre-wrap; overflow-wrap: anywhere; }
`;

/** JSON for an inline script: no `<` survives, so no `</script>` can close the element early. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function page(title: string, body: string, status: number, csp: string, referrerPolicy: ReferrerPolicy = 'no-referrer', bodyAttributes = ''): Response {
  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Overdeck</title>
<style>${STYLE}</style>
</head>
<body${bodyAttributes}>
${body}
</body>
</html>
`;
  return new Response(doc, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Referrer-Policy': referrerPolicy,
    },
  });
}

function detectScript(shortCode: string): string {
  return `(() => {
  const code = ${scriptJson(shortCode)};
  const origins = ${scriptJson(LOCAL_DASHBOARD_ORIGINS)};
  const status = document.getElementById("detect-status");
  async function probe(origin) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    try {
      const res = await fetch(origin + "/api/share-probe", { credentials: "omit", signal: ctl.signal });
      if (!res.ok) return false;
      const body = await res.json();
      return body !== null && body.overdeck === true;
    } catch { return false; } finally { clearTimeout(timer); }
  }
  (async () => {
    for (const origin of origins) {
      if (await probe(origin)) {
        if (document.documentElement.dataset.hostedJoin === "started") {
          status.textContent = "Overdeck is running on this computer. You can also open it there.";
          return;
        }
        status.textContent = "Opening Overdeck…";
        location.assign(origin + "/#/shared/" + code);
        return;
      }
    }
    status.textContent = "Overdeck is not running on this computer, or this browser blocked the check.";
  })();
})();`;
}

/**
 * 200 for an active room. `shortCode` is already normalized to the 8-symbol alphabet. With `web`
 * null the page is the local-dashboard page only; otherwise it adds the hosted viewer section.
 */
export function invitePage(shortCode: string, nonce: string, web: HostedWeb | null = null): Response {
  const code = escapeHtml(shortCode);
  const local =
    '<h1>You were invited to a shared Overdeck conversation</h1>' +
    '<p id="detect-status">Looking for Overdeck on this computer…</p>' +
    `<p><a id="open-local" href="${LOCAL_DASHBOARD_ORIGINS[0]}/#/shared/${code}">Open it in Overdeck on this computer</a></p>` +
    '<p>Overdeck not opening? Start it with <code>pan up</code>, then reload this page. ' +
    'If your browser asks whether this page may reach apps on this device, choose Allow. ' +
    `If your dashboard uses another port, open <code>http://localhost:&lt;port&gt;/#/shared/${code}</code>.</p>` +
    `<p>New to Overdeck? <a href="${escapeHtml(INSTALL_DOCS_URL)}">Install it first</a>.</p>`;
  const probe = `<script nonce="${escapeHtml(nonce)}">${detectScript(shortCode)}</script>`;
  if (!web) return page('Shared conversation', local + probe, 200, invitePageCsp(nonce));
  const body =
    `<section id="local-join">${local}</section>` +
    '<section id="web-join" hidden><h2>Join in this browser</h2><p>Loading…</p></section>' +
    probe +
    '<script src="/viewer/viewer.js" defer></script>';
  return page('Shared conversation', body, 200, invitePageCsp(nonce, web), 'same-origin', ` data-short-code="${code}"`);
}

/** A plain page with no script (the web sign-in outcomes, PAN-4481). Callers escape every value in `bodyHtml`. */
export function messagePage(title: string, bodyHtml: string, status: number): Response {
  return page(title, bodyHtml, status, HTML_CSP, 'same-origin');
}

/** 404 for an unknown, ended or malformed code. Says nothing about whether the code ever existed. */
export function endedPage(): Response {
  return page('Share link ended', '<h1>This share link has ended or does not exist.</h1>', 404, HTML_CSP);
}
