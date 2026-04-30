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
    return baseStatus;
  }

  const lines = logRaw.split('\n').slice(-50);
  const burned = lines.some((line) => line.includes('refresh token has already been used'));
  if (!burned) {
    return baseStatus;
  }

  const { stat } = await import('fs/promises');
  let mtime: Date;
  try {
    const s = await stat(logPath);
    mtime = s.mtime;
  } catch {
    return baseStatus;
  }

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  if (mtime.getTime() < oneHourAgo) {
    return baseStatus;
  }

  return { status: 'burned', email, expiresAt };
}
