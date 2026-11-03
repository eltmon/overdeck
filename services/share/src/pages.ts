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
 */

export const HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";
export const INSTALL_DOCS_URL = 'https://docs.overdeck.ai/quickstart';
/** The default `dashboard.api_port`; a dashboard on another port uses the manual link. */
export const LOCAL_DASHBOARD_ORIGINS = ['http://localhost:3011', 'http://127.0.0.1:3011'] as const;

export function invitePageCsp(nonce: string): string {
  return `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${LOCAL_DASHBOARD_ORIGINS.join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  code { font: 1.1rem/1.4 ui-monospace, monospace; padding: 0.2rem 0.4rem; border: 1px solid #8884; }
`;

/** JSON for an inline script: no `<` survives, so no `</script>` can close the element early. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function page(title: string, body: string, status: number, csp: string): Response {
  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Overdeck</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
  return new Response(doc, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Referrer-Policy': 'no-referrer',
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
        status.textContent = "Opening Overdeck…";
        location.assign(origin + "/#/shared/" + code);
        return;
      }
    }
    status.textContent = "Overdeck is not running on this computer, or this browser blocked the check.";
  })();
})();`;
}

/** 200 for an active room. `shortCode` is already normalized to the 8-symbol alphabet. */
export function invitePage(shortCode: string, nonce: string): Response {
  const code = escapeHtml(shortCode);
  const body =
    '<h1>You were invited to a shared Overdeck conversation</h1>' +
    '<p id="detect-status">Looking for Overdeck on this computer…</p>' +
    `<p><a id="open-local" href="${LOCAL_DASHBOARD_ORIGINS[0]}/#/shared/${code}">Open it in Overdeck on this computer</a></p>` +
    '<p>Overdeck not opening? Start it with <code>pan up</code>, then reload this page. ' +
    'If your browser asks whether this page may reach apps on this device, choose Allow. ' +
    `If your dashboard uses another port, open <code>http://localhost:&lt;port&gt;/#/shared/${code}</code>.</p>` +
    `<p>New to Overdeck? <a href="${escapeHtml(INSTALL_DOCS_URL)}">Install it first</a>.</p>` +
    `<script nonce="${escapeHtml(nonce)}">${detectScript(shortCode)}</script>`;
  return page('Shared conversation', body, 200, invitePageCsp(nonce));
}

/** A plain page with no script (the web sign-in outcomes, PAN-4481). Callers escape every value in `bodyHtml`. */
export function messagePage(title: string, bodyHtml: string, status: number): Response {
  return page(title, bodyHtml, status, HTML_CSP);
}

/** 404 for an unknown, ended or malformed code. Says nothing about whether the code ever existed. */
export function endedPage(): Response {
  return page('Share link ended', '<h1>This share link has ended or does not exist.</h1>', 404, HTML_CSP);
}
