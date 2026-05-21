/**
 * Internal token — shared secret for server-internal endpoints (PAN-891).
 *
 * Used by routes such as `POST /api/internal/pipeline/notify` that perform
 * stateful side effects but are not part of the public API surface. Without
 * this, any process that can reach the dashboard port could inject domain
 * events into the live event stream.
 *
 * Resolution order:
 *   1. `PANOPTICON_INTERNAL_TOKEN` env var (preferred for tests / explicit setup)
 *   2. `<PANOPTICON_HOME>/internal-token` (auto-generated on first server start)
 *
 * The dashboard server calls `ensureInternalToken()` once at startup, which
 * generates a random token and persists it with mode 0600 if neither source is
 * present. CLI processes (running as the same user) read it via
 * `getInternalToken()` and attach it as the `X-Panopticon-Internal-Token`
 * header. If the CLI cannot resolve a token (e.g. dashboard never started),
 * `notifyPipeline()` skips the cross-process forward — the SQLite write is
 * already durable, so no domain event is ever lost.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Effect } from 'effect';

import { getPanopticonHome } from './paths.js';
import { FsError } from './errors.js';

export const INTERNAL_TOKEN_HEADER = 'x-panopticon-internal-token';
const TOKEN_FILE_NAME = 'internal-token';

let cachedToken: string | null | undefined;

function tokenFilePath(): string {
  return join(getPanopticonHome(), TOKEN_FILE_NAME);
}

/**
 * Resolve the internal token from env or file. Returns null if neither source
 * is present. Callers (CLI senders) should treat null as "no dashboard available
 * to authenticate against" and skip the cross-process forward.
 */
export function getInternalToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;

  const fromEnv = process.env.PANOPTICON_INTERNAL_TOKEN;
  if (fromEnv && fromEnv.length > 0) {
    cachedToken = fromEnv;
    return cachedToken;
  }

  const path = tokenFilePath();
  if (existsSync(path)) {
    try {
      const value = readFileSync(path, 'utf8').trim();
      if (value.length > 0) {
        cachedToken = value;
        return cachedToken;
      }
    } catch {
      // fall through
    }
  }

  cachedToken = null;
  return cachedToken;
}

/**
 * Ensure the internal token exists. Generates and persists a random 32-byte
 * hex token (mode 0600) if neither env nor file is present. Idempotent: safe
 * to call on every server startup.
 *
 * Called from the dashboard server's main.ts so that CLI senders started
 * afterwards can read the same value via {@link getInternalToken}.
 */
export function ensureInternalToken(): string {
  const existing = getInternalToken();
  if (existing) return existing;

  const home = getPanopticonHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
  }

  const token = randomBytes(32).toString('hex');
  const path = tokenFilePath();
  writeFileSync(path, token + '\n', { mode: 0o600 });
  // writeFileSync's mode arg is ignored if the file already exists; force it.
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort
  }

  cachedToken = token;
  return token;
}

/**
 * Test-only: clear the cached token so the next read re-resolves from env/file.
 */
export function _resetInternalTokenCacheForTests(): void {
  cachedToken = undefined;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native variant of getInternalToken. Returns the resolved token or
 * null; never fails — read errors collapse to null like the underlying
 * function. Wrapped to compose with Effect call sites.
 */
export const getInternalTokenEffect = (): Effect.Effect<string | null, never> =>
  Effect.sync(() => getInternalToken());

/**
 * Effect-native variant of ensureInternalToken. Fails with FsError if the
 * panopticon home directory or token file cannot be written.
 */
export const ensureInternalTokenEffect = (): Effect.Effect<string, FsError> =>
  Effect.try({
    try: () => ensureInternalToken(),
    catch: (cause) =>
      new FsError({ path: tokenFilePath(), operation: 'ensureInternalToken', cause }),
  });
