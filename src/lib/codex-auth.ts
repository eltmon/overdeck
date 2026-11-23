import { open, readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { Data } from 'effect';
import { decodeJwtPayload, getCliproxyAuthDir, getCliproxyLogPath } from './cliproxy.js';
import type { CodexAuthFailure } from './conversations/codex-thread-status.js';

/**
 * Which store a codex auth status came from (PAN-2285). 'native' = the codex
 * CLI's own ~/.codex/auth.json (used by codex-harness agents); 'cliproxy' =
 * CLIProxy's bridged codex-primary.json (used by gpt-5.x under claude-code).
 */
export type CodexAuthSource = 'native' | 'cliproxy';

/** Wrapper error for Codex auth probing — preserves the underlying cause. */
export class CodexAuthCheckError extends Data.TaggedError('CodexAuthCheckError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface CodexAuthValid {
  status: 'valid';
  email: string;
  expiresAt: string;
  source?: CodexAuthSource;
}

export interface CodexAuthExpired {
  status: 'expired';
  email: string;
  expiresAt: string;
  source?: CodexAuthSource;
}

export interface CodexAuthBurned {
  status: 'burned';
  email: string;
  expiresAt: string;
  source?: CodexAuthSource;
  /** Session ids whose newest turn failed on sign-in (PAN-5633). */
  affectedAgents?: string[];
}

export interface CodexAuthMissing {
  status: 'missing';
  source?: CodexAuthSource;
}

export interface CodexAuthUnknown {
  status: 'unknown';
  message?: string;
  source?: CodexAuthSource;
}

export type CodexAuthStatus = CodexAuthValid | CodexAuthExpired | CodexAuthBurned | CodexAuthMissing | CodexAuthUnknown;

export interface CheckCodexAuthOptions {
  ignoreBurnBefore?: number;
  /** PAN-5633: live Codex sessions whose newest turn failed on sign-in (auth-failure-scan.ts). */
  authFailures?: readonly CodexAuthFailure[];
}

interface CliproxyCodexCredentials {
  access_token?: string;
  refresh_token?: string;
  email?: string;
  type?: string;
}

/**
 * An access token past its `exp` is not dead while a refresh token is present:
 * the codex CLI and CLIProxyAPI both mint a new access token from it on next use.
 * Only a lapsed token with no refresh token is truly expired. A used or revoked
 * refresh token is caught separately, by a failed turn (PAN-5633).
 */
function hasRefreshToken(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

// ─── Native ~/.codex/auth.json store (PAN-2285) ────────────────────────────────

/** Absolute path to the codex CLI's own global credential file. */
export function getNativeCodexAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json');
}

interface NativeCodexAuthFile {
  OPENAI_API_KEY?: unknown;
  last_refresh?: unknown;
  tokens?: {
    access_token?: unknown;
    id_token?: unknown;
    refresh_token?: unknown;
  };
}

export interface NativeCodexAuthResult {
  status: 'valid' | 'expired' | 'missing' | 'unknown';
  email?: string;
  expiresAt?: string;
  lastRefresh?: string;
}

/**
 * Pure classifier for the native store's raw JSON (PAN-2285). Decodes the
 * access_token JWT `exp` to decide valid/expired; a lapsed access token with a
 * refresh token is refreshable, so it is valid; reports missing when the file
 * is absent (raw === null) and unknown when it is malformed. API-key mode
 * (OPENAI_API_KEY set, no OAuth tokens) is a valid auth state. Exported for
 * testing with fabricated JWTs.
 */
export function classifyNativeCodexAuth(raw: string | null, now: number = Date.now()): NativeCodexAuthResult {
  if (raw === null) return { status: 'missing' };

  let parsed: NativeCodexAuthFile;
  try {
    parsed = JSON.parse(raw) as NativeCodexAuthFile;
  } catch {
    return { status: 'unknown' };
  }

  const lastRefresh = typeof parsed.last_refresh === 'string' ? parsed.last_refresh : undefined;
  const accessToken = typeof parsed.tokens?.access_token === 'string' ? parsed.tokens.access_token : null;

  if (!accessToken) {
    // No OAuth token; codex may be in API-key mode (a valid, non-expiring state).
    if (typeof parsed.OPENAI_API_KEY === 'string' && parsed.OPENAI_API_KEY) {
      return { status: 'valid', lastRefresh };
    }
    return { status: 'unknown', lastRefresh };
  }

  const idToken = typeof parsed.tokens?.id_token === 'string' ? parsed.tokens.id_token : null;
  const idClaims = idToken ? decodeJwtPayload(idToken) : null;
  const email = idClaims && typeof idClaims.email === 'string' ? idClaims.email : undefined;

  const accessClaims = decodeJwtPayload(accessToken);
  const expSec = accessClaims && typeof accessClaims.exp === 'number' ? accessClaims.exp : null;
  if (expSec === null) return { status: 'unknown', email, lastRefresh };

  const expiresAt = new Date(expSec * 1000).toISOString();
  if (expSec * 1000 <= now && !hasRefreshToken(parsed.tokens?.refresh_token)) {
    return { status: 'expired', email, expiresAt, lastRefresh };
  }
  return { status: 'valid', email, expiresAt, lastRefresh };
}

/** Async native-store probe used by the dashboard status endpoint and the spawn gate. */
async function probeNativeCodexAuth(now: number = Date.now()): Promise<NativeCodexAuthResult & { mtimeMs: number }> {
  const path = getNativeCodexAuthPath();
  let raw: string | null;
  let mtimeMs = 0;
  try {
    raw = await readFile(path, 'utf8');
    mtimeMs = (await stat(path)).mtimeMs;
  } catch {
    raw = null;
  }
  return { ...classifyNativeCodexAuth(raw, now), mtimeMs };
}

// ─── Turn-failure burn signal (PAN-5633) ───────────────────────────────────────
//
// A used or revoked refresh token is invisible statically: the access token may
// still look refreshable. The proof is a failed turn. Codex records it in the
// session's rollout as `task_complete.error` with `codex_error_info: "unauthorized"`
// (src/lib/conversations/codex-thread-status.ts reads it). auth-failure-scan.ts
// collects those failures across live Codex sessions; callers pass them in, so
// this module imports no agent or conversation store. A failure older than the
// last write of ~/.codex/auth.json is healed: every managed CODEX_HOME symlinks to
// it, so one `codex login` fixes every session without a restart.

/** Pure: the failures that happened at or after the native store's last write. */
export function activeCodexAuthFailures(failures: readonly CodexAuthFailure[], nativeMtimeMs: number): CodexAuthFailure[] {
  return failures.filter((failure) => {
    const at = Date.parse(failure.at);
    return Number.isFinite(at) && at >= nativeMtimeMs;
  });
}

// ─── Combined status (native ⊕ cliproxy ⊕ failed turns) ────────────────────────

const CODEX_AUTH_SEVERITY: Record<CodexAuthStatus['status'], number> = {
  burned: 4,
  expired: 3,
  valid: 2,
  missing: 1,
  unknown: 0,
};

function nativeToStatus(native: NativeCodexAuthResult): CodexAuthStatus {
  switch (native.status) {
    case 'valid':
      return { status: 'valid', email: native.email ?? '', expiresAt: native.expiresAt ?? '', source: 'native' };
    case 'expired':
      return { status: 'expired', email: native.email ?? '', expiresAt: native.expiresAt ?? '', source: 'native' };
    case 'missing':
      return { status: 'missing', source: 'native' };
    case 'unknown':
      return { status: 'unknown', source: 'native' };
  }
}

function withSource(status: CodexAuthStatus, source: CodexAuthSource): CodexAuthStatus {
  return { ...status, source };
}

/**
 * Merge the native and cliproxy statuses into the single worst state the banner
 * should react to (burned > expired > valid > missing > unknown). Both stores
 * are healed by the same `codex login`, so surfacing the more severe one is
 * correct and its remedy is identical. Exported for testing.
 */
export function combineCodexAuthStatuses(
  native: CodexAuthStatus,
  cliproxy: CodexAuthStatus,
): CodexAuthStatus {
  const nativeSev = CODEX_AUTH_SEVERITY[native.status];
  const cliproxySev = CODEX_AUTH_SEVERITY[cliproxy.status];
  // Tie → prefer native (PAN-2285 is about the native codex-harness store).
  return cliproxySev > nativeSev ? withSource(cliproxy, 'cliproxy') : native;
}

/**
 * Check the Codex (ChatGPT subscription) auth state. I/O errors are swallowed and
 * reported through the status union; it rejects only if the check itself throws
 * unexpectedly.
 */
export async function checkCodexAuthStatus(options: CheckCodexAuthOptions = {}): Promise<CodexAuthStatus> {
  const now = Date.now();
  const native = await probeNativeCodexAuth(now);
  const cliproxy = await checkCliproxyCodexAuthStatus(options);

  // A failed turn is the strongest signal for the native store: the token can
  // still look refreshable while its refresh token is already used, so it beats
  // the static probe. The failures come from the live sessions' rollouts
  // (auth-failure-scan.ts); ones older than the last `codex login` are healed.
  const active = activeCodexAuthFailures(options.authFailures ?? [], native.mtimeMs);
  if (active.length > 0) {
    return {
      status: 'burned',
      email: native.email ?? '',
      expiresAt: native.expiresAt ?? '',
      source: 'native',
      affectedAgents: active.map((failure) => failure.id),
    };
  }

  return combineCodexAuthStatuses(nativeToStatus(native), cliproxy);
}

/**
 * Spawn gate (PAN-2285): refuse to launch a NEW codex-harness agent while the
 * native codex auth is unusable — missing/expired file or any live session whose
 * newest turn failed on sign-in after the last `codex login` (PAN-5633; the
 * shared token family is dead). `loadAuthFailures` is called only for the codex
 * harness. Resumes are exempt: the symlink migration in initCodexHome heals a
 * stale home on relaunch. Throws a clear, remedy-naming error, mirroring the
 * harness-policy ToS gate.
 */
export async function assertCodexNativeAuthForSpawn(
  harness: string | undefined,
  loadAuthFailures: () => Promise<readonly CodexAuthFailure[]>,
): Promise<void> {
  if (harness !== 'codex') return;
  const native = await probeNativeCodexAuth();
  const reason =
    native.status === 'missing'
      ? 'not signed in (~/.codex/auth.json is missing)'
      : native.status === 'expired'
        ? 'expired (~/.codex/auth.json access token has lapsed and has no refresh token)'
        : activeCodexAuthFailures(await loadAuthFailures(), native.mtimeMs).length > 0
          ? 'revoked (a running Codex session failed a turn on sign-in — the shared token family is dead)'
          : null;
  if (reason === null) return;
  throw new Error(
    `Cannot spawn a Codex agent: native Codex authentication is ${reason}. ` +
      'Run `codex login` on the host (or click Re-authenticate in the dashboard Codex-auth banner), then retry.',
  );
}

async function checkCliproxyCodexAuthStatus(options: CheckCodexAuthOptions = {}): Promise<CodexAuthStatus> {
  const credPath = join(getCliproxyAuthDir(), 'codex-primary.json');

  let raw: string;
  let credMtimeMs: number | null = null;
  try {
    raw = await readFile(credPath, 'utf8');
    credMtimeMs = (await stat(credPath)).mtimeMs;
  } catch {
    return { status: 'missing' };
  }

  let creds: CliproxyCodexCredentials;
  try {
    creds = JSON.parse(raw) as CliproxyCodexCredentials;
  } catch {
    return { status: 'unknown', message: 'Malformed credential file' };
  }

  const accessToken = typeof creds.access_token === 'string' ? creds.access_token : null;
  if (!accessToken) {
    return { status: 'unknown', message: 'Missing access_token in credential file' };
  }

  const claims = decodeJwtPayload(accessToken);
  if (!claims) {
    return { status: 'unknown', message: 'Unable to decode access_token' };
  }

  const expSec = typeof claims.exp === 'number' ? claims.exp : null;
  if (expSec === null) {
    return { status: 'unknown', message: 'Missing exp claim in access_token' };
  }

  const email = typeof creds.email === 'string' ? creds.email : '';
  const expiresAt = new Date(expSec * 1000).toISOString();

  if (expSec * 1000 <= Date.now() && !hasRefreshToken(creds.refresh_token)) {
    return { status: 'expired', email, expiresAt };
  }

  // Unexpired, or lapsed but refreshable: CLIProxyAPI refreshes it itself. The
  // burn override below still catches a refresh token that has been revoked.
  const jwtStatus: CodexAuthStatus = { status: 'valid', email, expiresAt };
  // The credential file's own write time is the authoritative "you last logged
  // in at" reference: any auth failure logged AFTER it means the CURRENT token
  // is dead. An explicit caller option (the re-auth flow's session.createdAt)
  // still wins. Without this, callers that pass no option fell back to the crude
  // 1h staleness window and reported a burned token as "valid" once the burn
  // line aged out — exactly the gap that let gpt-5.5 agents spawn into 503s.
  const effectiveOptions: CheckCodexAuthOptions = {
    ignoreBurnBefore: options.ignoreBurnBefore ?? credMtimeMs ?? undefined,
  };
  return await applyBurnedTokenOverride(jwtStatus, email, expiresAt, effectiveOptions);
}

/** Read the trailing window of the cliproxy log for burn/failure analysis. */
async function readLogTail(path: string): Promise<string> {
  const TAIL_BYTES = 128 * 1024;
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    const length = Math.min(stat.size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, stat.size - length);
    return buffer.toString('utf8');
  } finally {
    await file.close();
  }
}

async function applyBurnedTokenOverride(
  baseStatus: CodexAuthStatus,
  email: string,
  expiresAt: string,
  options: CheckCodexAuthOptions,
): Promise<CodexAuthStatus> {
  let logRaw: string;
  try {
    logRaw = await readLogTail(getCliproxyLogPath());
  } catch {
    return baseStatus;
  }
  return evaluateBurnedFromLog(logRaw, baseStatus, email, expiresAt, options);
}

const BURN_STALENESS_MS = 60 * 60 * 1000;

/**
 * Pure decision: given the cliproxy log tail, decide whether a JWT-valid token
 * is actually burned. Exported for regression testing (PAN-1584).
 *
 * "Auth failure" evidence = either a refresh-token burn line
 * (`refresh token has already been used`, `refresh_token_reused`, or a
 * non-retryable `token refresh failed with status 401`) OR a `503` on `/v1/messages` /
 * `/v1/chat/completions` (the live symptom the agent hits once cliproxy disables
 * the provider — and which keeps appearing after the burn line stops, since a
 * disabled provider no longer attempts refreshes). "Success" = a `200` on those
 * same paths (proves the auth path works right now).
 *
 * Decision:
 *   - No failure evidence              → trust base status.
 *   - Success AFTER the last failure   → trust base status (recovered).
 *   - Failure AFTER the credential's last write (ignoreBurnBefore) → BURNED,
 *     regardless of age. The credential write time is when you last logged in;
 *     a failure after it means the current token is dead. This is authoritative
 *     and is the fix for the bug where a >1h-stale burn line was dismissed as
 *     "valid" during a quiet period even though the token was dead (PAN-1584).
 *   - Failure BEFORE that cutoff       → trust base status (re-authed since).
 *   - No cutoff available              → fall back to the staleness backstop:
 *     burned only if the last failure is within BURN_STALENESS_MS.
 *
 * We intentionally don't probe cliproxy with HTTP — `GET /v1/models` always
 * 401s (it needs real OAuth, not the local key) and would generate spurious log
 * lines on every dashboard load.
 */
export function evaluateBurnedFromLog(
  logRaw: string,
  baseStatus: CodexAuthStatus,
  email: string,
  expiresAt: string,
  options: CheckCodexAuthOptions & { now?: number } = {},
): CodexAuthStatus {
  const now = options.now ?? Date.now();
  // Scan a wider window than the original 50 lines so a quiet recovery period
  // can still surface a later success.
  const lines = logRaw.split('\n').slice(-500);

  // PAN-913 matched `refresh token has already been used`; PAN-1455 adds
  // `refresh_token_reused`. PAN-3528 adds the openai_auth.go line those two sit
  // under: a non-retryable 401 on refresh is the definitive "this credential is
  // dead" signal, it covers revocations whose JSON body says neither of the
  // above, and — unlike the continuation lines — it carries its own timestamp.
  const isBurnLine = (l: string) =>
    l.includes('refresh token has already been used')
    || l.includes('refresh_token_reused')
    || l.includes('token refresh failed with status 401');
  const isAuthFailure503 = (l: string) =>
    /\b503 \|/.test(l) && /POST\s+"\/v1\/(messages|chat\/completions)/.test(l);
  const isSuccess = (l: string) =>
    /\b200 \|/.test(l) && /POST\s+"\/v1\/(messages|chat\/completions)/.test(l);

  // The bracketed timestamp lives on the gin_logger/openai_auth line; burn
  // messages sit on a JSON continuation line with no prefix, so scan back a few
  // lines for the nearest one.
  //
  // PAN-3528: cliproxy stamps these in LOCAL time, not UTC. Parsing them with a
  // trailing `Z` shifted every failure by the host's UTC offset — on a UTC-4
  // host that made a burn look 4 hours OLDER than it was, so it fell before the
  // credential-write cutoff below and the endpoint reported a dead token as
  // "valid" while every gpt-5.6 agent 503'd. Omitting the offset makes
  // Date.parse interpret the stamp in local time, which is what it is.
  const timestampAt = (idx: number): number | null => {
    for (let j = idx; j >= Math.max(0, idx - 10); j--) {
      const m = lines[j]?.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]/);
      if (m) {
        const t = Date.parse(`${m[1]}T${m[2]}`);
        if (Number.isFinite(t)) return t;
      }
    }
    return null;
  };

  let lastFailureIdx = -1;
  let lastFailureTimestamp: number | null = null;
  let lastSuccessIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (lastFailureIdx < 0 && (isBurnLine(line) || isAuthFailure503(line))) {
      lastFailureIdx = i;
      lastFailureTimestamp = timestampAt(i);
    }
    if (lastSuccessIdx < 0 && isSuccess(line)) {
      lastSuccessIdx = i;
    }
    if (lastFailureIdx >= 0 && lastSuccessIdx >= 0) break;
  }

  // No failure evidence at all → trust the JWT-based status.
  if (lastFailureIdx < 0) return baseStatus;

  // A successful LLM call came AFTER the failure → auth path works again.
  if (lastSuccessIdx > lastFailureIdx) return baseStatus;

  // Authoritative path: we know when the credential was last written. A failure
  // after that write means the CURRENT token is dead — flag burned no matter how
  // old the line is. (Pad by 1000ms: burn lines carry second-precision stamps, so
  // a credential written in the same second as the failure shouldn't look newer.)
  if (options.ignoreBurnBefore !== undefined) {
    if (lastFailureTimestamp !== null && lastFailureTimestamp + 1000 <= options.ignoreBurnBefore) {
      return baseStatus;
    }
    return { status: 'burned', email, expiresAt };
  }

  // No credential-write reference → staleness backstop only.
  if (lastFailureTimestamp !== null && now - lastFailureTimestamp > BURN_STALENESS_MS) {
    return baseStatus;
  }

  return { status: 'burned', email, expiresAt };
}
