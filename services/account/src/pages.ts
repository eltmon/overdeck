/**
 * Server-rendered HTML pages. No JavaScript; inline CSS only (CSP `style-src 'unsafe-inline'`).
 * Every interpolated value goes through escapeHtml() (D-28).
 */
import { html } from './http.ts';

export const SESSION_VAULT_DOCS_URL = 'https://docs.overdeck.ai/configuration/session-vault';

/** D-13 wording, shown to any GitHub account that is neither the owner nor allowlisted. */
export const INVITE_ONLY_TEXT =
  'Overdeck accounts are invite-only right now. Everything local keeps working, and you can use your own git remote for Session Vault.';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; }
  .muted { opacity: 0.75; }
  .warn { color: #b45309; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #8884; vertical-align: top; }
  form.inline { display: inline; }
  input, button { font: inherit; }
`;

/** Full document. `title` is escaped here; `body` is HTML the caller already escaped. */
export function layout(title: string, body: string): string {
  return `<!doctype html>
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
}

/** Plain message page; `message` is escaped. */
export function messagePage(status: number, title: string, message: string, extra?: HeadersInit): Response {
  return html(layout(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`), status, extra);
}

export function errorPage(status: number, message: string, title = 'Something went wrong'): Response {
  return messagePage(status, title, message);
}

export function inviteOnlyPage(): Response {
  const body =
    `<h1>Invite-only</h1><p>${escapeHtml(INVITE_ONLY_TEXT)}</p>` +
    `<p><a href="${escapeHtml(SESSION_VAULT_DOCS_URL)}">Session Vault with your own remote</a></p>`;
  return html(layout('Invite-only', body), 403);
}

export function rateLimitedPage(retryAfterS: number, message = 'Too many requests. Wait a few minutes and try again.'): Response {
  return messagePage(429, 'Too many requests', message, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterS))) });
}
