/** Plugin config reader and the connectorUrl rule (PAN-4954 FR-3, D-4; PAN-4927 W-INT2).
 * The URL rule parses with `URL` and compares the exact hostname, so `http://localhost.evil.example`
 * is refused (MYN security review W1/W5). Refusal reasons never echo the configured value. */
import type { JsonSchema } from './openclaw-api.js';

export const DEFAULT_CONNECTOR_URL = 'http://127.0.0.1:7466/mcp';

export const CONFIG_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    connectorUrl: { type: 'string', default: DEFAULT_CONNECTOR_URL, description: 'The Overdeck connector (or dashboard over Tailscale) MCP URL.' },
    localToken: { type: 'string', description: 'The connector local token, or an Overdeck access token on the Tailscale route.' },
    summary: { type: 'boolean', default: true, description: 'Add a needs-you summary to agent turns, at most every 5 minutes.' },
    allowAnswers: { type: 'boolean', default: false, description: 'Let overdeck_answer answer Overdeck prompts.' },
  },
};

export interface OverdeckPluginConfig { connectorUrl: string; localToken: string | null; summary: boolean; allowAnswers: boolean }

const UNRESOLVED_ENV_REFERENCE = /^\$\{[A-Za-z0-9_]+\}$/;

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function readConfig(raw: Record<string, unknown> | undefined): OverdeckPluginConfig {
  const config = raw ?? {};
  const token = nonEmptyString(config.localToken);
  return {
    connectorUrl: nonEmptyString(config.connectorUrl) ?? DEFAULT_CONNECTOR_URL,
    localToken: token !== null && !UNRESOLVED_ENV_REFERENCE.test(token) ? token : null,
    summary: config.summary !== false,
    allowAnswers: config.allowAnswers === true,
  };
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function checkConnectorUrl(value: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'connectorUrl is not a valid URL' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'connectorUrl must not contain a user name or password' };
  }
  if (url.protocol === 'https:') return { ok: true, url };
  if (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname)) return { ok: true, url };
  return { ok: false, reason: 'connectorUrl must use https://, or http:// on 127.0.0.1, localhost or [::1]' };
}
