import { open, readFile } from 'fs/promises';
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

interface CheckCodexAuthOptions {
  ignoreBurnBefore?: number;
}

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
export async function checkCodexAuthStatus(options: CheckCodexAuthOptions = {}): Promise<CodexAuthStatus> {
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
  return await applyBurnedTokenOverride(jwtStatus, email, expiresAt, options);
}

/**
 * Override status to 'burned' only when there is recent, unambiguous
 * evidence that the OAuth refresh path is dead.
 *
 * Signals (all from the cliproxy log):
 *   1. The last burn line in the tail window.
 *   2. The last 200 on /v1/messages or /v1/chat/completions — this proves
 *      cliproxy auto-retried with a fresh token and the auth path works.
 *
 * Decision:
 *   - No burn line in window           → trust base status.
 *   - Burn + later success             → trust base status (auto-retry won).
 *   - Burn + no later success + stale  → trust base status (no recent traffic;
 *                                        the burn line is from a quiet period
 *                                        where nothing tried, so we have no
 *                                        evidence the path is broken right now).
 *   - Burn + no later success + recent → flag as burned.
 *
 * We intentionally don't probe cliproxy with HTTP — `GET /v1/models` always
 * 401s (it needs real OAuth, not the local key) and would generate
 * spurious log lines on every dashboard load.
 */
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
  const logPath = getCliproxyLogPath();

  let logRaw: string;
  try {
    logRaw = await readLogTail(logPath);
  } catch {
    return baseStatus;
  }

  // Scan a wider window than the original 50 lines so a quiet recovery
  // period can still suppress an older burn line.
  const lines = logRaw.split('\n').slice(-500);
  let lastBurnIdx = -1;
  let lastSuccessIdx = -1;
  let lastBurnTimestamp: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (lastBurnIdx < 0 && line.includes('refresh token has already been used')) {
      lastBurnIdx = i;
      // Look backwards a few lines for the gin_logger or openai_auth.go line
      // with the surrounding bracketed timestamp.
      for (let j = i; j >= Math.max(0, i - 10) && lastBurnTimestamp === null; j--) {
        const m = lines[j]?.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]/);
        if (m) {
          const t = Date.parse(`${m[1]}T${m[2]}Z`);
          if (Number.isFinite(t)) lastBurnTimestamp = t;
        }
      }
    }
    if (lastSuccessIdx < 0 && /\b200 \|/.test(line) && /POST\s+"\/v1\/(messages|chat\/completions)/.test(line)) {
      lastSuccessIdx = i;
    }
    if (lastBurnIdx >= 0 && lastSuccessIdx >= 0) break;
  }

  // No burn evidence at all → trust the JWT-based status.
  if (lastBurnIdx < 0) return baseStatus;

  // A successful LLM call came AFTER the burn line → auto-retry worked.
  if (lastSuccessIdx > lastBurnIdx) return baseStatus;

  if (lastBurnTimestamp !== null && options.ignoreBurnBefore !== undefined && lastBurnTimestamp < options.ignoreBurnBefore) {
    return baseStatus;
  }

  const BURN_STALENESS_MS = 60 * 60 * 1000;
  if (lastBurnTimestamp !== null && Date.now() - lastBurnTimestamp > BURN_STALENESS_MS) {
    return baseStatus;
  }

  return { status: 'burned', email, expiresAt };
}
