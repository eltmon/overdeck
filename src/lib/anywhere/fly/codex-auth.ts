/**
 * Codex sign-in on Fly machines (PAN-4296 WI-3).
 *
 * A Codex conversation on a Fly machine uses the Codex CLI's own sign-in,
 * `$HOME/.codex/auth.json` on the VM, and calls OpenAI directly (no CLIProxy,
 * D-1). OpenAI rotates the refresh token on every refresh, so a copy of
 * `auth.json` forks the refresh-token family: when one side refreshes, the
 * other side's token is revoked. Home and VM therefore stay in step by
 * "newest refresh wins" (D-3), decided by `decideCodexAuthSync()` over parsed
 * snapshots, never over raw bytes.
 *
 * This module holds the snapshot parser, that decision, the VM read (D-8) and
 * push (D-7) helpers over the Machines exec API, the atomic home write, and
 * `readHomeCodexState()`, which says whether home can prepare Codex at all
 * (D-2: a codex binary, its version, and a valid native sign-in).
 *
 * No `auth.json` content, token, or base64 of either appears in a log line, an
 * error message, or an error detail (NFR-2). `app-server-manager.js` pulls in
 * `ws`, so it is imported dynamically where it is needed (D-10).
 */
import { randomUUID } from 'node:crypto';
import { readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { classifyNativeCodexAuth, getNativeCodexAuthPath } from '../../codex-auth.js';
import { resolveHarnessBinary } from '../../harness-binary.js';
import { shellQuote } from '../../remote/remote-tmux.js';

export type CodexAuthMode = 'chatgpt' | 'api-key' | 'unknown';

export interface CodexAuthSnapshot {
  raw: string;
  mode: CodexAuthMode;
  accountId: string | null;
  lastRefreshMs: number | null;
  /** ChatGPT sign-in with all four tokens (`access_token`, `id_token`, `refresh_token`, `account_id`). */
  complete: boolean;
  /** The sign-in's content (D-3), compared instead of bytes; null for `unknown`. */
  key: string | null;
}

export type CodexAuthSyncAction = 'push' | 'pull' | 'none';

/** One command on the VM through the Machines exec API. */
export type FlyExec = (command: string, timeoutSeconds: number) => Promise<{ stdout: string; stderr: string; exit_code: number }>;

export type VmCodexAuthRead = { state: 'present'; raw: string } | { state: 'missing' } | { state: 'indeterminate' };

export interface HomeCodexState {
  binary: string;
  version: string;
  authRaw: string;
}

export interface HomeCodexDeps {
  resolveBinary: () => Promise<string | null>;
  readVersion: (binary: string) => Promise<string | undefined>;
  /** The native `auth.json`, or null when it is absent or unreadable. */
  readAuth: () => Promise<string | null>;
}

const MISSING_MARKER = '__MISSING__';
const READ_TIMEOUT_SECONDS = 30;
const PUSH_TIMEOUT_SECONDS = 30;
/**
 * The exec payload limit is about 16 KB (PAN-4652 hazard). `auth.json` is about
 * 5 KB (7 KB base64), so D-7 sends it in one command; anything over this is not
 * a Codex sign-in we know, and it is refused rather than chunked.
 */
const MAX_PUSH_BASE64 = 12_000;

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function unknownSnapshot(raw: string): CodexAuthSnapshot {
  return { raw, mode: 'unknown', accountId: null, lastRefreshMs: null, complete: false, key: null };
}

/** Parse a native Codex `auth.json`. Bad JSON, or neither tokens nor an API key, is `unknown`. */
export function parseCodexAuthSnapshot(raw: string): CodexAuthSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unknownSnapshot(raw);
  }
  if (typeof parsed !== 'object' || parsed === null) return unknownSnapshot(raw);
  const file = parsed as { OPENAI_API_KEY?: unknown; last_refresh?: unknown; tokens?: unknown };
  const tokens = (typeof file.tokens === 'object' && file.tokens !== null ? file.tokens : {}) as Record<string, unknown>;

  if (typeof tokens.access_token === 'string') {
    const accessToken = text(tokens.access_token);
    const idToken = text(tokens.id_token);
    const refreshToken = text(tokens.refresh_token);
    const accountId = text(tokens.account_id);
    const lastRefresh = typeof file.last_refresh === 'string' ? file.last_refresh : null;
    const lastRefreshMs = lastRefresh === null ? null : Date.parse(lastRefresh);
    return {
      raw,
      mode: 'chatgpt',
      accountId,
      lastRefreshMs: lastRefreshMs === null || Number.isNaN(lastRefreshMs) ? null : lastRefreshMs,
      complete: accessToken !== null && idToken !== null && refreshToken !== null && accountId !== null,
      key: JSON.stringify([tokens.access_token, tokens.id_token ?? null, tokens.refresh_token ?? null, tokens.account_id ?? null, lastRefresh]),
    };
  }

  const apiKey = text(file.OPENAI_API_KEY);
  if (apiKey !== null) {
    return { raw, mode: 'api-key', accountId: null, lastRefreshMs: null, complete: false, key: apiKey };
  }
  return unknownSnapshot(raw);
}

/**
 * Newest refresh wins (D-3), rules in order:
 * 1. home missing or `unknown` ⇒ none; 2. VM missing or `unknown` ⇒ push;
 * 3. same mode and same key ⇒ none; 4. both ChatGPT, same non-empty account,
 * complete VM copy, strictly newer VM `last_refresh` ⇒ pull; 5. otherwise push
 * (home decides which account is signed in).
 */
export function decideCodexAuthSync(home: CodexAuthSnapshot | null, vm: CodexAuthSnapshot | null): CodexAuthSyncAction {
  if (home === null || home.mode === 'unknown') return 'none';
  if (vm === null || vm.mode === 'unknown') return 'push';
  if (home.mode === vm.mode && home.key === vm.key) return 'none';
  if (
    home.mode === 'chatgpt' &&
    vm.mode === 'chatgpt' &&
    home.accountId !== null &&
    home.accountId === vm.accountId &&
    vm.complete &&
    home.lastRefreshMs !== null &&
    vm.lastRefreshMs !== null &&
    vm.lastRefreshMs > home.lastRefreshMs
  ) {
    return 'pull';
  }
  return 'push';
}

/** Read the VM's `auth.json` (D-8). A non-zero exit or a thrown exec is indeterminate: neither push nor pull. */
export async function readVmCodexAuth(exec: FlyExec, path: string): Promise<VmCodexAuthRead> {
  const quoted = shellQuote(path);
  let result: Awaited<ReturnType<FlyExec>>;
  try {
    result = await exec(`if [ -f ${quoted} ]; then cat ${quoted}; else printf ${MISSING_MARKER}; fi`, READ_TIMEOUT_SECONDS);
  } catch {
    return { state: 'indeterminate' };
  }
  if (result.exit_code !== 0) return { state: 'indeterminate' };
  if (result.stdout === MISSING_MARKER) return { state: 'missing' };
  return { state: 'present', raw: result.stdout };
}

/**
 * Write `raw` to `path` on the VM (D-7): a temp file with mode 0600, then a
 * rename, so the per-conversation symlinks that resolve the path by name stay
 * valid. Errors name the path and exit code only (NFR-2).
 */
export async function pushVmCodexAuth(exec: FlyExec, path: string, raw: string): Promise<void> {
  const encoded = Buffer.from(raw, 'utf8').toString('base64');
  if (encoded.length > MAX_PUSH_BASE64) {
    throw new Error(`Could not write ${path} on the Fly machine: the sign-in file is ${encoded.length} base64 characters, over the ${MAX_PUSH_BASE64}-character exec limit`);
  }
  const dir = shellQuote(dirname(path));
  const temp = shellQuote(`${path}.tmp`);
  const target = shellQuote(path);
  const command = `mkdir -p ${dir} && printf %s '${encoded}' | base64 -d > ${temp} && chmod 600 ${temp} && mv -f ${temp} ${target}`;
  let code: number | string;
  try {
    code = (await exec(command, PUSH_TIMEOUT_SECONDS)).exit_code;
  } catch {
    code = 'unknown: the exec call failed';
  }
  if (code !== 0) throw new Error(`Could not write ${path} on the Fly machine (exit ${code})`);
}

/**
 * Write home's native Codex `auth.json` atomically with mode 0600. When the
 * path is a symlink, the target is written, so the link keeps pointing at it.
 */
export async function writeHomeCodexAuth(raw: string, deps: { authPath?: string } = {}): Promise<void> {
  const authPath = deps.authPath ?? getNativeCodexAuthPath();
  let target = authPath;
  try {
    target = await realpath(authPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temp = join(dirname(target), `.auth.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, raw, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function readNativeAuth(): Promise<string | null> {
  try {
    return await readFile(getNativeCodexAuthPath(), 'utf8');
  } catch {
    return null;
  }
}

async function readVersionDefault(binary: string): Promise<string | undefined> {
  const { readCodexCliVersion } = await import('../../codex/app-server-manager.js');
  return readCodexCliVersion(binary);
}

/** Home's Codex binary, version and valid native sign-in (D-2), or null when any is missing. */
export async function readHomeCodexState(overrides: Partial<HomeCodexDeps> = {}): Promise<HomeCodexState | null> {
  const deps: HomeCodexDeps = {
    resolveBinary: overrides.resolveBinary ?? (() => resolveHarnessBinary('codex')),
    readVersion: overrides.readVersion ?? readVersionDefault,
    readAuth: overrides.readAuth ?? readNativeAuth,
  };
  const binary = await deps.resolveBinary();
  if (!binary) return null;
  const version = await deps.readVersion(binary);
  if (!version) return null;
  const authRaw = await deps.readAuth();
  if (authRaw === null || classifyNativeCodexAuth(authRaw).status !== 'valid') return null;
  return { binary, version, authRaw };
}
