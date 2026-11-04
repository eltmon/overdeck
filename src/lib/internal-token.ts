/**
 * Internal token — shared secret for server-internal endpoints (PAN-891).
 *
 * Used by routes such as `POST /api/internal/pipeline/notify` that perform
 * stateful side effects but are not part of the public API surface. Without
 * this, any process that can reach the dashboard port could inject domain
 * events into the live event stream.
 *
 * Resolution order:
 *   1. `<OVERDECK_HOME>/internal-token` — written by the first
 *      `ensureInternalToken()` call (dashboard boot, `pan serve`, or a CLI
 *      sender).
 *   2. `OVERDECK_INTERNAL_TOKEN` env var — used only when no file exists;
 *      `ensureInternalToken()` then persists it as the file's value.
 *
 * The file wins over the env var because a long-lived terminal-backend
 * server (Herdr or tmux) keeps the env it had when it started, and every
 * pane it opens inherits that env. After a later launch mints a new env
 * token, those panes would otherwise keep sending a stale one forever
 * (PAN-4628). Re-reading the file on every call means a pane repairs itself
 * on its next CLI call or hook run, with no restart needed.
 *
 * The dashboard server calls `ensureInternalToken()` once at startup, which
 * generates a random token and persists it with mode 0600 if neither source is
 * present. CLI processes (running as the same user) read it via
 * `getInternalToken()` and attach it as the `X-Overdeck-Internal-Token`
 * header. If the CLI cannot resolve a token (e.g. dashboard never started),
 * `notifyPipelineSync()` skips the cross-process forward — the SQLite write is
 * already durable, so no domain event is ever lost.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { getOverdeckHome } from './paths.js';

export const INTERNAL_TOKEN_HEADER = 'x-overdeck-internal-token';
const TOKEN_FILE_NAME = 'internal-token';

type CachedToken = { readonly token: string; readonly source: 'file' | 'env' } | null;
let cached: CachedToken | undefined;

function tokenFilePath(): string {
  return join(getOverdeckHome(), TOKEN_FILE_NAME);
}

function readTokenFile(): string | null {
  const path = tokenFilePath();
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function envToken(): string | null {
  const value = process.env.OVERDECK_INTERNAL_TOKEN;
  return value && value.length > 0 ? value : null;
}

/**
 * Resolve the internal token from the file, else env. Returns null if neither
 * source is present. Callers (CLI senders) should treat null as "no dashboard
 * available to authenticate against" and skip the cross-process forward.
 * Never writes.
 */
export function getInternalToken(): string | null {
  if (cached !== undefined) return cached?.token ?? null;

  const fromFile = readTokenFile();
  if (fromFile) {
    cached = { token: fromFile, source: 'file' };
  } else {
    const fromEnv = envToken();
    cached = fromEnv ? { token: fromEnv, source: 'env' } : null;
  }
  return cached?.token ?? null;
}

/**
 * Ensure the internal token exists. Returns the file's value when present;
 * otherwise seeds the file from the env token, or a random 32-byte hex token,
 * and persists it with mode 0600. Idempotent: safe to call on every server
 * startup, and on every request once the file exists (NFR-2: no file I/O once
 * the cache holds a file-sourced value).
 *
 * Called from the dashboard server's main.ts so that CLI senders started
 * afterwards can read the same value via {@link getInternalToken}.
 */
export function ensureInternalToken(): string {
  if (cached?.source === 'file') return cached.token;

  const fromFile = readTokenFile();
  if (fromFile) {
    cached = { token: fromFile, source: 'file' };
    return fromFile;
  }

  const home = getOverdeckHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
  }

  const token = envToken() ?? randomBytes(32).toString('hex');
  const path = tokenFilePath();
  writeFileSync(path, token + '\n', { mode: 0o600 });
  // writeFileSync's mode arg is ignored if the file already exists; force it.
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort
  }

  cached = { token, source: 'file' };
  return token;
}

/**
 * Test-only: clear the cached token so the next read re-resolves from file/env.
 */
export function _resetInternalTokenCacheForTests(): void {
  cached = undefined;
}
