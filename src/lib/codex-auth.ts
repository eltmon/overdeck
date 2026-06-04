import { open, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { Effect, Data } from 'effect';
import { decodeJwtPayload, getCliproxyAuthDir, getCliproxyLogPath } from './cliproxy.js';

/** Wrapper error for Codex auth probing — preserves the underlying cause. */
export class CodexAuthCheckError extends Data.TaggedError('CodexAuthCheckError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface CodexAuthValid {
  status: 'valid';
  email: string;
  expiresAt: string;
}

export interface CodexAuthExpired {
  status: 'expired';
  email: string;
  expiresAt: string;
}

export interface CodexAuthBurned {
  status: 'burned';
  email: string;
  expiresAt: string;
}

export interface CodexAuthMissing {
  status: 'missing';
}

export interface CodexAuthUnknown {
  status: 'unknown';
  message?: string;
}

export type CodexAuthStatus = CodexAuthValid | CodexAuthExpired | CodexAuthBurned | CodexAuthMissing | CodexAuthUnknown;

interface CheckCodexAuthOptions {
  ignoreBurnBefore?: number;
}

interface CliproxyCodexCredentials {
  access_token?: string;
  email?: string;
  type?: string;
}async function checkCodexAuthStatusPromise(options: CheckCodexAuthOptions = {}): Promise<CodexAuthStatus> {
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

  if (expSec * 1000 <= Date.now()) {
    return { status: 'expired', email, expiresAt };
  }

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
 * (`refresh token has already been used`) OR a `503` on `/v1/messages` /
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

  const isBurnLine = (l: string) => l.includes('refresh token has already been used');
  const isAuthFailure503 = (l: string) =>
    /\b503 \|/.test(l) && /POST\s+"\/v1\/(messages|chat\/completions)/.test(l);
  const isSuccess = (l: string) =>
    /\b200 \|/.test(l) && /POST\s+"\/v1\/(messages|chat\/completions)/.test(l);

  // The bracketed timestamp lives on the gin_logger/openai_auth line; burn
  // messages sit on a JSON continuation line with no prefix, so scan back a few
  // lines for the nearest one.
  const timestampAt = (idx: number): number | null => {
    for (let j = idx; j >= Math.max(0, idx - 10); j--) {
      const m = lines[j]?.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]/);
      if (m) {
        const t = Date.parse(`${m[1]}T${m[2]}Z`);
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native checkCodexAuthStatus. The Promise version is designed to
 * swallow all I/O errors and report the auth state through the typed status
 * union. The Effect variant wraps that to make it composable; it only fails
 * with CodexAuthCheckError if the underlying call itself throws unexpectedly
 * (i.e., not from the documented "missing/unknown" branches).
 */
export const checkCodexAuthStatus = (
  options: { ignoreBurnBefore?: number } = {},
): Effect.Effect<CodexAuthStatus, CodexAuthCheckError> =>
  Effect.tryPromise({
    try: () => checkCodexAuthStatusPromise(options),
    catch: (cause) =>
      new CodexAuthCheckError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
