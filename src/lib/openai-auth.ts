/**
 * openai-auth.ts
 *
 * Reads Codex/ChatGPT local auth state and keeps the CLIProxy subscription
 * credential store in sync. OpenAI models are supported only through
 * Codex/ChatGPT subscription auth routed via CLIProxyAPI; API-key fallback is
 * intentionally not used because api.openai.com does not expose an
 * Anthropic-compatible /v1/messages endpoint.
 */

import { existsSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { bridgeCodexAuthToCliproxy } from './cliproxy.js';

export interface OpenAIAuthStatus {
  /** True if Codex auth storage exists locally. */
  installed: boolean;
  /** True if Codex/ChatGPT OAuth refresh credentials are available. */
  loggedIn: boolean;
  /** True if the access token is expired, even if refresh may still succeed. */
  expired: boolean;
  /** Auth mode persisted by Codex (usually "chatgpt" for subscription auth). */
  authMode: string | null;
  /** Codex account identifier, if present. */
  accountId: string | null;
  /** When Codex last refreshed auth state, if recorded. */
  lastRefresh: string | null;
  /** Access-token expiry timestamp in ms, if it can be derived from the JWT. */
  accessTokenExpiresAt: number | null;
  /** True when an OpenAI API key is present in auth.json or env. */
  hasOpenAIApiKey: boolean;
  /** True when Panopticon bridged ~/.codex/auth.json into CLIProxy config. */
  bridgedFromCodex: boolean;
}

interface RawAuthFile {
  auth_mode?: unknown;
  last_refresh?: unknown;
  OPENAI_API_KEY?: unknown;
  tokens?: {
    id_token?: unknown;
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  };
}

function getCodexAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json');
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + padding, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;

  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) return null;

  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getJwtExpiry(token: string | null): number | null {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
}

async function readCodexAuthAsync(authPath: string): Promise<RawAuthFile | null> {
  if (!existsSync(authPath)) return null;
  try {
    return JSON.parse(await readFile(authPath, 'utf8')) as RawAuthFile;
  } catch {
    return null;
  }
}

function readCodexAuthSync(authPath: string): RawAuthFile | null {
  if (!existsSync(authPath)) return null;
  try {
    return JSON.parse(readFileSync(authPath, 'utf8')) as RawAuthFile;
  } catch {
    return null;
  }
}

function hasApiKey(raw: RawAuthFile | null): boolean {
  return !!process.env.OPENAI_API_KEY
    || (typeof raw?.OPENAI_API_KEY === 'string' && raw.OPENAI_API_KEY.trim().length > 0);
}

function buildStatus(raw: RawAuthFile | null, installed: boolean, bridgedFromCodex: boolean): OpenAIAuthStatus {
  const authMode = typeof raw?.auth_mode === 'string' ? raw.auth_mode : null;
  const lastRefresh = typeof raw?.last_refresh === 'string' ? raw.last_refresh : null;
  const codexAccessToken = typeof raw?.tokens?.access_token === 'string' ? raw.tokens.access_token : null;
  const codexRefreshToken = typeof raw?.tokens?.refresh_token === 'string' ? raw.tokens.refresh_token : null;
  const codexIdToken = typeof raw?.tokens?.id_token === 'string' ? raw.tokens.id_token : null;
  const codexAccountId = typeof raw?.tokens?.account_id === 'string' ? raw.tokens.account_id : null;
  const accessTokenExpiresAt = getJwtExpiry(codexAccessToken) ?? getJwtExpiry(codexIdToken);

  return {
    installed,
    loggedIn: !!codexRefreshToken,
    expired: !!(accessTokenExpiresAt && accessTokenExpiresAt < Date.now()),
    authMode,
    accountId: codexAccountId,
    lastRefresh,
    accessTokenExpiresAt,
    hasOpenAIApiKey: hasApiKey(raw),
    bridgedFromCodex,
  };
}

export async function getOpenAIAuthStatus(): Promise<OpenAIAuthStatus> {
  const codexDir = join(homedir(), '.codex');
  const authPath = getCodexAuthPath();
  const installed = existsSync(codexDir) || existsSync(authPath);
  const raw = await readCodexAuthAsync(authPath);

  let bridgedFromCodex = false;
  try {
    if (bridgeCodexAuthToCliproxy()) {
      bridgedFromCodex = true;
    }
  } catch { /* non-fatal — cliproxy bridge is best-effort */ }

  return buildStatus(raw, installed, bridgedFromCodex);
}

/** Synchronous variant for CLI-side code. Dashboard server routes should use {@link getOpenAIAuthStatus}. */
export function getOpenAIAuthStatusSync(): OpenAIAuthStatus {
  const codexDir = join(homedir(), '.codex');
  const authPath = getCodexAuthPath();
  const installed = existsSync(codexDir) || existsSync(authPath);
  const raw = readCodexAuthSync(authPath);

  let bridgedFromCodex = false;
  try {
    if (bridgeCodexAuthToCliproxy()) {
      bridgedFromCodex = true;
    }
  } catch { /* non-fatal */ }

  return buildStatus(raw, installed, bridgedFromCodex);
}
