/**
 * openai-auth.ts
 *
 * Reads Codex/ChatGPT local auth state from ~/.codex/auth.json so Panopticon
 * can surface subscription-login status in Settings and route GPT models
 * through claudish without requiring an API key.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface OpenAIAuthStatus {
  /** True if the ~/.codex directory exists (Codex installed / initialized). */
  installed: boolean;
  /** True if a ChatGPT/Codex OAuth session appears to be present. */
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

export function getOpenAIAuthStatusSync(): OpenAIAuthStatus {
  const codexDir = join(homedir(), '.codex');
  const authPath = join(codexDir, 'auth.json');
  const installed = existsSync(codexDir);

  const defaultStatus: OpenAIAuthStatus = {
    installed,
    loggedIn: false,
    expired: false,
    authMode: null,
    accountId: null,
    lastRefresh: null,
    accessTokenExpiresAt: null,
    hasOpenAIApiKey: !!process.env.OPENAI_API_KEY,
  };

  if (!existsSync(authPath)) {
    return defaultStatus;
  }

  try {
    const raw = JSON.parse(readFileSync(authPath, 'utf8')) as RawAuthFile;
    const authMode = typeof raw.auth_mode === 'string' ? raw.auth_mode : null;
    const lastRefresh = typeof raw.last_refresh === 'string' ? raw.last_refresh : null;
    const accessToken = typeof raw.tokens?.access_token === 'string' ? raw.tokens.access_token : null;
    const refreshToken = typeof raw.tokens?.refresh_token === 'string' ? raw.tokens.refresh_token : null;
    const idToken = typeof raw.tokens?.id_token === 'string' ? raw.tokens.id_token : null;
    const accountId = typeof raw.tokens?.account_id === 'string' ? raw.tokens.account_id : null;
    const accessTokenExpiresAt = getJwtExpiry(accessToken) ?? getJwtExpiry(idToken);
    const expired = !!(accessTokenExpiresAt && accessTokenExpiresAt < Date.now());
    const hasOpenAIApiKey = defaultStatus.hasOpenAIApiKey
      || (typeof raw.OPENAI_API_KEY === 'string' && raw.OPENAI_API_KEY.trim().length > 0);

    return {
      installed,
      loggedIn: authMode === 'chatgpt' && !!(refreshToken || accessToken || idToken),
      expired,
      authMode,
      accountId,
      lastRefresh,
      accessTokenExpiresAt,
      hasOpenAIApiKey,
    };
  } catch {
    return defaultStatus;
  }
}

export async function getOpenAIAuthStatus(): Promise<OpenAIAuthStatus> {
  return getOpenAIAuthStatusSync();
}
