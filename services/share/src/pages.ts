/**
 * The `/s/:code` landing page (PRD PAN-658 "HTTP API"). No JavaScript; inline CSS only.
 *
 * The page never shows room data: no host name, scope or participant count. It only tells the
 * invitee how to join from their own Overdeck. routes.ts adds `Cache-Control` and `nosniff`.
 */

export const HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";
export const INSTALL_DOCS_URL = 'https://docs.overdeck.ai/quickstart';

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

function page(title: string, body: string, status: number): Response {
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
      'Content-Security-Policy': HTML_CSP,
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/** 200 for an active room. `shortCode` is already normalized to the 8-symbol alphabet. */
export function invitePage(shortCode: string): Response {
  const body =
    '<h1>You were invited to a shared Overdeck conversation</h1>' +
    '<p>Run this in a terminal on a machine with Overdeck installed:</p>' +
    `<p><code>pan join ${escapeHtml(shortCode)}</code></p>` +
    `<p>New to Overdeck? <a href="${escapeHtml(INSTALL_DOCS_URL)}">Install it first</a>.</p>`;
  return page('Shared conversation', body, 200);
}

/** 404 for an unknown, ended or malformed code. Says nothing about whether the code ever existed. */
export function endedPage(): Response {
  return page('Share link ended', '<h1>This share link has ended or does not exist.</h1>', 404);
}
