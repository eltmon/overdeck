import { open, readFile, stat } from 'fs/promises';
import { readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Effect, Data } from 'effect';
import { decodeJwtPayload, getCliproxyAuthDir, getCliproxyLogPath } from './cliproxy.js';
import { listOverdeckAgentStatesSync } from './overdeck/agent-state-sync.js';

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
  /** Agent ids whose live pane showed the revoked-token burn markers (PAN-2285). */
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

interface CheckCodexAuthOptions {
  ignoreBurnBefore?: number;
}

interface CliproxyCodexCredentials {
  access_token?: string;
  email?: string;
  type?: string;
}// ─── Native ~/.codex/auth.json store (PAN-2285) ────────────────────────────────

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
 * access_token JWT `exp` to decide valid/expired; reports missing when the file
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
  if (expSec * 1000 <= now) return { status: 'expired', email, expiresAt, lastRefresh };
  return { status: 'valid', email, expiresAt, lastRefresh };
}

/** Async native-store probe used by the dashboard status endpoint. */
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

/** Sync native-store probe used by the spawn gate. */
export function probeNativeCodexAuthSync(now: number = Date.now()): NativeCodexAuthResult {
  let raw: string | null;
  try {
    raw = readFileSync(getNativeCodexAuthPath(), 'utf8');
  } catch {
    raw = null;
  }
  return classifyNativeCodexAuth(raw, now);
}

function nativeCodexAuthMtimeSync(): number {
  try {
    return statSync(getNativeCodexAuthPath()).mtimeMs;
  } catch {
    return 0;
  }
}

// ─── Pane-burn flag, persisted in agent state (PAN-2285) ───────────────────────
//
// A revoked refresh token is invisible statically: the codex CLI keeps a valid
// (unexpired) access-token JWT while its refresh token is dead, and the failure
// never lands in the rollout JSONL — only in the live TUI pane. The deacon pane
// patrols grep for the burn markers and flag the agent; the status endpoint and
// spawn gate consult the flags so the CodexAuthBanner fires and new codex spawns
// are refused.
//
// CRITICAL: the writers (deacon patrols) run in the deacon CHILD process while
// the readers (the /api/settings/codex-auth endpoint and the spawn gate) run in
// the dashboard server process — module memory does NOT cross that boundary. The
// flag is therefore persisted in the agent's own state (troubled +
// lastFailureReason prefixed `codex-auth-burned[<ISO flag time>]`), written
// through saveAgentStateSync — which mirrors into the shared SQLite agents
// table — and read back through the agents-table door
// (listOverdeckAgentStatesSync). No new store, no in-memory registry.

/** The revoked-token markers that appear in a burned codex agent's pane. */
const CODEX_AUTH_BURN_MARKERS = [
  'could not be refreshed because your refresh token was revoked',
  'token_invalidated',
  'token_revoked',
];

/**
 * Pure classifier over a codex agent's pane tail (PAN-2285). True when the pane
 * shows the revoked/invalidated refresh-token error. Exported so it is testable
 * without tmux.
 */
export function paneShowsCodexAuthBurn(paneText: string): boolean {
  return CODEX_AUTH_BURN_MARKERS.some((marker) => paneText.includes(marker));
}

/** lastFailureReason prefix that marks an agent as codex-auth-burned. */
export const CODEX_AUTH_BURNED_REASON_PREFIX = 'codex-auth-burned';

/**
 * Minimal structural slice of AgentState the burn flag lives in. Declared
 * structurally (rather than importing AgentState) so the flag helpers stay pure
 * and this module adds no import edge toward the agents barrel (which exports
 * spawn.ts — a module that imports this one).
 */
export interface CodexAuthBurnFlagState {
  troubled?: boolean;
  troubledAt?: string;
  lastFailureReason?: string;
  lastFailureAt?: string;
}

/**
 * Mark an agent state as codex-auth-burned (PAN-2285). Pure mutation — the
 * caller persists via the agent-state write door (saveAgentStateSync), which
 * mirrors into the shared agents table so the flag crosses the deacon/server
 * process boundary. Returns true only when the state was newly flagged
 * (idempotent: an already-flagged state is left untouched), so callers can emit
 * a single operator notice instead of one per patrol tick. The flag time is
 * embedded in the reason (`codex-auth-burned[<ISO>]`) because the agents table
 * has no dedicated column for it and `troubledAt` may predate the burn when the
 * agent was already troubled for another reason.
 */
export function applyCodexAuthBurnFlag(state: CodexAuthBurnFlagState, nowMs: number = Date.now()): boolean {
  if (state.troubled && state.lastFailureReason?.startsWith(CODEX_AUTH_BURNED_REASON_PREFIX)) {
    return false;
  }
  const nowIso = new Date(nowMs).toISOString();
  state.troubled = true;
  if (!state.troubledAt) state.troubledAt = nowIso;
  state.lastFailureReason =
    `${CODEX_AUTH_BURNED_REASON_PREFIX}[${nowIso}]: Codex refresh token was revoked — ` +
    're-authenticate (dashboard Codex-auth banner has a Re-authenticate button, or run `codex login`)';
  state.lastFailureAt = nowIso;
  return true;
}

/**
 * When (epoch ms) a state was flagged codex-auth-burned, or null if it is not
 * currently flagged. Requires the troubled gate to still be set — `pan
 * untroubled` / resume clears troubled and the failure fields, which retires the
 * flag. Parses the ISO stamp embedded in the reason; falls back to `troubledAt`
 * for flags written by builds that predate the embedded stamp.
 */
export function codexAuthBurnFlaggedAtMs(state: CodexAuthBurnFlagState): number | null {
  if (!state.troubled) return null;
  const reason = state.lastFailureReason;
  if (!reason?.startsWith(CODEX_AUTH_BURNED_REASON_PREFIX)) return null;
  const embedded = reason.match(/^codex-auth-burned\[([^\]]+)\]/)?.[1];
  const fromReason = embedded ? Date.parse(embedded) : Number.NaN;
  if (Number.isFinite(fromReason)) return fromReason;
  const fromTroubledAt = state.troubledAt ? Date.parse(state.troubledAt) : Number.NaN;
  return Number.isFinite(fromTroubledAt) ? fromTroubledAt : 0;
}

/**
 * Pure filter: which of these agent states are burned AND still current? Flags
 * recorded strictly before the native store's last write are stale: a global
 * `codex login` rewrites ~/.codex/auth.json (bumping its mtime) and heals every
 * agent through the shared symlink, so those burns no longer apply (the flag
 * itself is retired when the agent is untroubled/resumed).
 */
export function filterCodexAuthBurnedAgentIds(
  states: ReadonlyArray<CodexAuthBurnFlagState & { id: string }>,
  nativeMtimeMs: number,
): string[] {
  const active: string[] = [];
  for (const state of states) {
    const flaggedAt = codexAuthBurnFlaggedAtMs(state);
    if (flaggedAt !== null && flaggedAt >= nativeMtimeMs) active.push(state.id);
  }
  return active;
}

/**
 * Agents currently flagged codex-auth-burned, read from the shared agents table
 * (the runtime registry) so flags written by the deacon child process are
 * visible here in the dashboard server process.
 */
export function listCodexAuthBurnedAgentsSync(nativeMtimeMs: number): string[] {
  try {
    return filterCodexAuthBurnedAgentIds(listOverdeckAgentStatesSync(), nativeMtimeMs);
  } catch {
    return [];
  }
}

/** Sync convenience for the spawn gate: are any agents still burned right now? */
export function hasActiveBurnedCodexAgentsSync(): boolean {
  return listCodexAuthBurnedAgentsSync(nativeCodexAuthMtimeSync()).length > 0;
}

// ─── Combined status (native ⊕ cliproxy ⊕ pane-burn) ───────────────────────────

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

async function checkCodexAuthStatusPromise(options: CheckCodexAuthOptions = {}): Promise<CodexAuthStatus> {
  const now = Date.now();
  const native = await probeNativeCodexAuth(now);
  const cliproxy = await checkCliproxyCodexAuthStatusPromise(options);

  // Live pane-burn is the strongest signal for the native store: the JWT can
  // still be unexpired while the refresh token is revoked, so it beats the
  // static probe. Flags are read from the shared agents table — the deacon
  // child process wrote them there via saveAgentStateSync.
  const activeBurned = listCodexAuthBurnedAgentsSync(native.mtimeMs);
  if (activeBurned.length > 0) {
    return {
      status: 'burned',
      email: native.email ?? '',
      expiresAt: native.expiresAt ?? '',
      source: 'native',
      affectedAgents: activeBurned,
    };
  }

  return combineCodexAuthStatuses(nativeToStatus(native), cliproxy);
}

/**
 * Spawn gate (PAN-2285): refuse to launch a NEW codex-harness agent while the
 * native codex auth is unusable — missing/expired file or any agent currently
 * burned (revoked refresh token shared across the family). Resumes are exempt:
 * the symlink migration in initCodexHome heals a stale home on relaunch. Throws
 * a clear, remedy-naming error, mirroring the harness-policy ToS gate.
 */
export function assertCodexNativeAuthForSpawn(harness: string | undefined): void {
  if (harness !== 'codex') return;
  const native = probeNativeCodexAuthSync();
  const reason =
    native.status === 'missing'
      ? 'not signed in (~/.codex/auth.json is missing)'
      : native.status === 'expired'
        ? 'expired (~/.codex/auth.json access token has lapsed)'
        : hasActiveBurnedCodexAgentsSync()
          ? 'revoked (a running codex agent hit a revoked refresh token — the shared token family is dead)'
          : null;
  if (reason === null) return;
  throw new Error(
    `Cannot spawn a Codex agent: native Codex authentication is ${reason}. ` +
      'Run `codex login` on the host (or click Re-authenticate in the dashboard Codex-auth banner), then retry.',
  );
}

async function checkCliproxyCodexAuthStatusPromise(options: CheckCodexAuthOptions = {}): Promise<CodexAuthStatus> {
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

  // PAN-913 matched `refresh token has already been used`; PAN-1455 adds `refresh_token_reused`.
  const isBurnLine = (l: string) =>
    l.includes('refresh token has already been used') || l.includes('refresh_token_reused');
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
