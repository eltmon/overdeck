/**
 * Grok Build sign-in status (PAN-5078 D7), read from the credentials `grok
 * login` saves in ~/.grok/auth.json. No subprocess: `grok models` reports "not
 * authenticated" even when ACP auth succeeds, and `grok whoami` needs a TTY.
 * The launch-time ACP `authenticate` call stays the authoritative check.
 * Never logs or returns a token value.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface GrokSignIn {
  readonly signedIn: boolean;
  readonly reason: 'ok' | 'missing' | 'unreadable' | 'no-credential' | 'expired';
}

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export async function readGrokSignIn(home = homedir(), now = new Date()): Promise<GrokSignIn> {
  let raw: string;
  try {
    raw = await readFile(join(home, '.grok', 'auth.json'), 'utf8');
  } catch (error) {
    return { signedIn: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { signedIn: false, reason: 'unreadable' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { signedIn: false, reason: 'unreadable' };
  }

  const credentials = Object.values(parsed).filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && nonEmptyString((entry as Record<string, unknown>).key),
  );
  if (credentials.length === 0) return { signedIn: false, reason: 'no-credential' };

  // Tokens last 7 days; OIDC sign-ins refresh silently through refresh_token.
  const usable = credentials.some((entry) => {
    const expiresAt = typeof entry.expires_at === 'string' ? Date.parse(entry.expires_at) : Number.NaN;
    return expiresAt > now.getTime() || nonEmptyString(entry.refresh_token);
  });
  return usable ? { signedIn: true, reason: 'ok' } : { signedIn: false, reason: 'expired' };
}
