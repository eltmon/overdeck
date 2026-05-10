import { readFile } from 'fs/promises';
import { join } from 'path';
import { decodeJwtPayload, getCliproxyAuthDir, getCliproxyLogPath } from './cliproxy.js';

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

interface CliproxyCodexCredentials {
  access_token?: string;
  email?: string;
  type?: string;
}

/**
 * Check whether the Codex OAuth credentials stored for CLIProxy are still valid.
 *
 * Reads ~/.panopticon/cliproxy/auth/codex-primary.json, decodes the JWT
 * access_token exp claim, and compares it to the current time.
 */
export async function checkCodexAuthStatus(): Promise<CodexAuthStatus> {
  const credPath = join(getCliproxyAuthDir(), 'codex-primary.json');

  let raw: string;
  try {
    raw = await readFile(credPath, 'utf8');
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
  return await applyBurnedTokenOverride(jwtStatus, email, expiresAt);
}

/**
 * Override status to 'burned' only when the most recent meaningful event
 * in the cliproxy log is a refresh-token-reused error. A successful 200
 * to /v1/messages or /v1/chat/completions AFTER the burn line proves
 * cliproxy recovered (it will auto-retry with a fresh token), so the
 * banner is suppressed even though historical burn lines remain in the log.
 *
 * Falls back to a live probe (GET /v1/models on the local cliproxy) when
 * the log heuristic can't make a confident call.
 */
async function applyBurnedTokenOverride(
  baseStatus: CodexAuthStatus,
  email: string,
  expiresAt: string,
): Promise<CodexAuthStatus> {
  const logPath = getCliproxyLogPath();

  let logRaw: string;
  try {
    logRaw = await readFile(logPath, 'utf8');
  } catch {
    // No log — nothing to override with. Trust the JWT-based base status.
    return baseStatus;
  }

  // Look across a wider window than the previous 50-line tail so a quiet
  // recovery period can still suppress an older burn line.
  const lines = logRaw.split('\n').slice(-500);
  let lastBurnIdx = -1;
  let lastSuccessIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (lastBurnIdx < 0 && line.includes('refresh token has already been used')) {
      lastBurnIdx = i;
    }
    // Match the gin_logger 200 lines for /v1/* endpoints (messages, chat/completions, models).
    if (lastSuccessIdx < 0 && /\b200 \|/.test(line) && /POST\s+"\/v1\//.test(line)) {
      lastSuccessIdx = i;
    }
    if (lastBurnIdx >= 0 && lastSuccessIdx >= 0) break;
  }

  // No burn signal at all — definitely valid.
  if (lastBurnIdx < 0) {
    return baseStatus;
  }

  // Burn happened, but a successful request came AFTER it — auto-retry worked.
  if (lastSuccessIdx > lastBurnIdx) {
    return baseStatus;
  }

  // Burn is the most recent signal in the log. Confirm with a live probe
  // before flipping to 'burned' — a transient log state shouldn't drive UX.
  const liveOk = await probeCliproxyAlive();
  if (liveOk) {
    return baseStatus;
  }

  return { status: 'burned', email, expiresAt };
}

/**
 * Best-effort liveness probe: ask cliproxy for its model list with a tight
 * timeout. A 2xx response means the proxy is currently serving requests, so
 * regardless of stale errors in the log the auth path is healthy.
 */
async function probeCliproxyAlive(timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('http://127.0.0.1:8317/v1/models', { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
