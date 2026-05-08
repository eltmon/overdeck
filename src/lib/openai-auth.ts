/**
 * openai-auth.ts
 *
 * Reads Codex/ChatGPT local auth state and keeps local subscription credential
 * stores in sync. OpenAI models are supported only through Codex/ChatGPT
 * subscription auth routed via CLIProxyAPI; API-key fallback is intentionally
 * not used because api.openai.com does not expose Anthropic-compatible
 * /v1/messages.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { bridgeCodexAuthToCliproxy } from './cliproxy.js';

export interface OpenAIAuthStatus {
  /** True if Codex/claudish auth storage exists locally. */
  installed: boolean;
  /** True if claudish-compatible Codex OAuth credentials are available. */
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
  /** True when Panopticon bridged ~/.codex/auth.json into claudish format. */
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

interface CodexOAuthCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  account_id?: string;
}

function getCodexAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json');
}

function getClaudishCodexPath(): string {
  return join(homedir(), '.claudish', 'codex-oauth.json');
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

async function readClaudishCredentialsAsync(): Promise<CodexOAuthCredentials | null> {
  const credPath = getClaudishCodexPath();
  try {
    await access(credPath);
  } catch {
    return null;
  }

  try {
    const raw = JSON.parse(await readFile(credPath, 'utf8')) as Partial<CodexOAuthCredentials>;
    if (
      typeof raw.access_token !== 'string'
      || typeof raw.refresh_token !== 'string'
      || typeof raw.expires_at !== 'number'
    ) {
      return null;
    }

    return {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token,
      expires_at: raw.expires_at,
      account_id: typeof raw.account_id === 'string' ? raw.account_id : undefined,
    };
  } catch {
    return null;
  }
}

async function deriveClaudishCredentialsFromCodexAsync(): Promise<CodexOAuthCredentials | null> {
  const authPath = getCodexAuthPath();
  try {
    await access(authPath);
  } catch {
    return null;
  }

  try {
    const raw = JSON.parse(await readFile(authPath, 'utf8')) as RawAuthFile;
    const accessToken = typeof raw.tokens?.access_token === 'string' ? raw.tokens.access_token : null;
    const refreshToken = typeof raw.tokens?.refresh_token === 'string' ? raw.tokens.refresh_token : null;
    const idToken = typeof raw.tokens?.id_token === 'string' ? raw.tokens.id_token : null;
    const accountId = typeof raw.tokens?.account_id === 'string' ? raw.tokens.account_id : undefined;
    const expiresAt = getJwtExpiry(accessToken) ?? getJwtExpiry(idToken);

    if (!accessToken || !refreshToken || !expiresAt) {
      return null;
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      // Force claudish to refresh immediately on first cx@ use. The cached
      // Codex access token may exist but still be rejected by the Codex
      // responses backend; the refresh token is the more reliable bridge.
      expires_at: 0,
      account_id: accountId,
    };
  } catch {
    return null;
  }
}

async function ensureClaudishCredentialsFileAsync(credentials: CodexOAuthCredentials): Promise<void> {
  const credPath = getClaudishCodexPath();
  const claudishDir = join(homedir(), '.claudish');
  try {
    await access(claudishDir);
  } catch {
    await mkdir(claudishDir, { recursive: true });
  }

  await writeFile(credPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
}

export async function getOpenAIAuthStatus(): Promise<OpenAIAuthStatus> {
  const codexDir = join(homedir(), '.codex');
  const authPath = getCodexAuthPath();
  const claudishCredPath = getClaudishCodexPath();
  const installed = existsSync(codexDir) || existsSync(claudishCredPath);

  const defaultStatus: OpenAIAuthStatus = {
    installed,
    loggedIn: false,
    expired: false,
    authMode: null,
    accountId: null,
    lastRefresh: null,
    accessTokenExpiresAt: null,
    hasOpenAIApiKey: !!process.env.OPENAI_API_KEY,
    bridgedFromCodex: false,
  };

  let raw: RawAuthFile | null = null;
  if (existsSync(authPath)) {
    try {
      raw = JSON.parse(await readFile(authPath, 'utf8')) as RawAuthFile;
    } catch {
      raw = null;
    }
  }

  const authMode = typeof raw?.auth_mode === 'string' ? raw.auth_mode : null;
  const lastRefresh = typeof raw?.last_refresh === 'string' ? raw.last_refresh : null;
  const codexAccessToken = typeof raw?.tokens?.access_token === 'string' ? raw.tokens.access_token : null;
  const codexRefreshToken = typeof raw?.tokens?.refresh_token === 'string' ? raw.tokens.refresh_token : null;
  const codexIdToken = typeof raw?.tokens?.id_token === 'string' ? raw.tokens.id_token : null;
  const codexAccountId = typeof raw?.tokens?.account_id === 'string' ? raw.tokens.account_id : null;
  const hasOpenAIApiKey = defaultStatus.hasOpenAIApiKey
    || (typeof raw?.OPENAI_API_KEY === 'string' && raw.OPENAI_API_KEY.trim().length > 0);

  let claudishCreds = await readClaudishCredentialsAsync();
  let bridgedFromCodex = false;

  if (!claudishCreds) {
    const derivedCreds = await deriveClaudishCredentialsFromCodexAsync();
    if (derivedCreds) {
      await ensureClaudishCredentialsFileAsync(derivedCreds);
      claudishCreds = derivedCreds;
      bridgedFromCodex = true;
    }
  }

  // Also keep the CLIProxyAPI credential file in sync so GPT agents routed
  // through the local cliproxy sidecar pick up fresh ChatGPT subscription
  // tokens without a restart. Non-fatal if this fails.
  try {
    if (bridgeCodexAuthToCliproxy()) {
      bridgedFromCodex = true;
    }
  } catch { /* non-fatal — cliproxy bridge is best-effort */ }

  const accessTokenExpiresAt = claudishCreds?.expires_at
    ?? getJwtExpiry(codexAccessToken) ?? getJwtExpiry(codexIdToken);
  const expired = !!(accessTokenExpiresAt && accessTokenExpiresAt < Date.now());

  return {
    installed,
    loggedIn: !!(claudishCreds?.refresh_token),
    expired,
    authMode,
    accountId: claudishCreds?.account_id ?? codexAccountId,
    lastRefresh,
    accessTokenExpiresAt,
    hasOpenAIApiKey,
    bridgedFromCodex,
  };
}

/** Synchronous variant for CLI-side code. Dashboard server routes should use {@link getOpenAIAuthStatus}. */
export function getOpenAIAuthStatusSync(): OpenAIAuthStatus {
  const codexDir = join(homedir(), '.codex');
  const authPath = getCodexAuthPath();
  const claudishCredPath = getClaudishCodexPath();
  const installed = existsSync(codexDir) || existsSync(claudishCredPath);

  const defaultStatus: OpenAIAuthStatus = {
    installed,
    loggedIn: false,
    expired: false,
    authMode: null,
    accountId: null,
    lastRefresh: null,
    accessTokenExpiresAt: null,
    hasOpenAIApiKey: !!process.env.OPENAI_API_KEY,
    bridgedFromCodex: false,
  };

  let raw: RawAuthFile | null = null;
  if (existsSync(authPath)) {
    try {
      raw = JSON.parse(readFileSync(authPath, 'utf8')) as RawAuthFile;
    } catch {
      raw = null;
    }
  }

  const authMode = typeof raw?.auth_mode === 'string' ? raw.auth_mode : null;
  const lastRefresh = typeof raw?.last_refresh === 'string' ? raw.last_refresh : null;
  const codexAccessToken = typeof raw?.tokens?.access_token === 'string' ? raw.tokens.access_token : null;
  const codexRefreshToken = typeof raw?.tokens?.refresh_token === 'string' ? raw.tokens.refresh_token : null;
  const codexIdToken = typeof raw?.tokens?.id_token === 'string' ? raw.tokens.id_token : null;
  const codexAccountId = typeof raw?.tokens?.account_id === 'string' ? raw.tokens.account_id : null;
  const hasOpenAIApiKey = defaultStatus.hasOpenAIApiKey
    || (typeof raw?.OPENAI_API_KEY === 'string' && raw.OPENAI_API_KEY.trim().length > 0);

  // Synchronous helpers (local scope, not exported)
  function readClaudishCredentialsSync(): CodexOAuthCredentials | null {
    if (!existsSync(claudishCredPath)) return null;
    try {
      const rawCred = JSON.parse(readFileSync(claudishCredPath, 'utf8')) as Partial<CodexOAuthCredentials>;
      if (
        typeof rawCred.access_token !== 'string'
        || typeof rawCred.refresh_token !== 'string'
        || typeof rawCred.expires_at !== 'number'
      ) {
        return null;
      }
      return {
        access_token: rawCred.access_token,
        refresh_token: rawCred.refresh_token,
        expires_at: rawCred.expires_at,
        account_id: typeof rawCred.account_id === 'string' ? rawCred.account_id : undefined,
      };
    } catch {
      return null;
    }
  }

  function deriveClaudishFromCodexSync(): CodexOAuthCredentials | null {
    if (!existsSync(authPath)) return null;
    try {
      const rawFile = JSON.parse(readFileSync(authPath, 'utf8')) as RawAuthFile;
      const accessToken = typeof rawFile.tokens?.access_token === 'string' ? rawFile.tokens.access_token : null;
      const refreshToken = typeof rawFile.tokens?.refresh_token === 'string' ? rawFile.tokens.refresh_token : null;
      const idToken = typeof rawFile.tokens?.id_token === 'string' ? rawFile.tokens.id_token : null;
      const accountId = typeof rawFile.tokens?.account_id === 'string' ? rawFile.tokens.account_id : undefined;
      const expiresAt = getJwtExpiry(accessToken) ?? getJwtExpiry(idToken);
      if (!accessToken || !refreshToken || !expiresAt) return null;
      return { access_token: accessToken, refresh_token: refreshToken, expires_at: 0, account_id: accountId };
    } catch {
      return null;
    }
  }

  let claudishCreds = readClaudishCredentialsSync();
  let bridgedFromCodex = false;

  if (!claudishCreds) {
    const derived = deriveClaudishFromCodexSync();
    if (derived) {
      const claudishDir = join(homedir(), '.claudish');
      if (!existsSync(claudishDir)) {
        mkdirSync(claudishDir, { recursive: true });
      }
      writeFileSync(claudishCredPath, `${JSON.stringify(derived, null, 2)}\n`, { mode: 0o600 });
      claudishCreds = derived;
      bridgedFromCodex = true;
    }
  }

  try {
    if (bridgeCodexAuthToCliproxy()) {
      bridgedFromCodex = true;
    }
  } catch { /* non-fatal */ }

  const accessTokenExpiresAt = claudishCreds?.expires_at
    ?? getJwtExpiry(codexAccessToken) ?? getJwtExpiry(codexIdToken);
  const expired = !!(accessTokenExpiresAt && accessTokenExpiresAt < Date.now());

  return {
    installed,
    loggedIn: !!(claudishCreds?.refresh_token),
    expired,
    authMode,
    accountId: claudishCreds?.account_id ?? codexAccountId,
    lastRefresh,
    accessTokenExpiresAt,
    hasOpenAIApiKey,
    bridgedFromCodex,
  };
}

