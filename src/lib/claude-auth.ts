/**
 * claude-auth.ts
 *
 * Reads Claude Code's credentials to determine whether the user is logged in
 * with a subscription (MAX / Pro / Team) or not.
 *
 * Credentials are checked in order:
 *   1. ~/.claude/.credentials.json  (Linux, older Claude Code versions)
 *   2. macOS Keychain: "Claude Code-credentials" (macOS with newer Claude Code)
 *
 * The credential payload contains:
 *   claudeAiOauth.subscriptionType  — "max" | "pro" | "team" | null
 *   claudeAiOauth.rateLimitTier     — e.g. "default_claude_max_20x"
 *   claudeAiOauth.accessToken       — OAuth bearer token
 *   claudeAiOauth.expiresAt         — Unix timestamp (ms)
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { platform } from 'process';

export interface ClaudeAuthStatus {
  /** True if the ~/.claude directory exists (i.e. Claude Code has been installed). */
  installed: boolean;
  /** True if a non-expired OAuth token is present. */
  loggedIn: boolean;
  /** True if the token exists but has already expired. */
  expired: boolean;
  /** "max" | "pro" | "team" | null — from claudeAiOauth.subscriptionType */
  subscriptionType: string | null;
  /** e.g. "default_claude_max_20x" */
  rateLimitTier: string | null;
  /** Token expiry timestamp in ms, or null if unknown. */
  expiresAt: number | null;
  /** True when ANTHROPIC_API_KEY is set in the server process environment.
   *  When present, Claude Code prefers this over subscription auth. */
  hasAnthropicApiKey: boolean;
}

/**
 * Read credentials JSON from macOS Keychain.
 * Claude Code ≥2.x stores credentials under service "Claude Code-credentials".
 */
async function readKeychainCredentials(): Promise<string | null> {
  if (platform !== 'darwin') return null;
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 3000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);
        resolve(stdout.trim());
      },
    );
  });
}

export function parseOAuthPayload(raw: string): {
  loggedIn: boolean;
  expired: boolean;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: number | null;
} {
  const creds = JSON.parse(raw) as Record<string, unknown>;
  const oauth = (creds.claudeAiOauth ?? {}) as Record<string, unknown>;

  if (!oauth.accessToken) {
    return { loggedIn: false, expired: false, subscriptionType: null, rateLimitTier: null, expiresAt: null };
  }

  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null;
  const expired = !!(expiresAt && expiresAt < Date.now());

  // Treat as logged in even if expired — Claude Code auto-refreshes tokens
  // transparently. Only mark as not-logged-in if there's no token at all.
  return {
    loggedIn: true,
    expired,
    subscriptionType: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null,
    rateLimitTier: typeof oauth.rateLimitTier === 'string' ? oauth.rateLimitTier : null,
    expiresAt,
  };
}

export async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
  const claudeDir = join(homedir(), '.claude');
  const credPath = join(claudeDir, '.credentials.json');

  const installed = existsSync(claudeDir);
  const hasAnthropicApiKey = !!process.env.ANTHROPIC_API_KEY;

  let loggedIn = false;
  let expired = false;
  let subscriptionType: string | null = null;
  let rateLimitTier: string | null = null;
  let expiresAt: number | null = null;

  // 1. Try flat credentials file (Linux, older Claude Code)
  if (existsSync(credPath)) {
    try {
      const raw = await readFile(credPath, 'utf-8');
      const result = parseOAuthPayload(raw);
      loggedIn = result.loggedIn;
      expired = result.expired;
      subscriptionType = result.subscriptionType;
      rateLimitTier = result.rateLimitTier;
      expiresAt = result.expiresAt;
    } catch {
      // Credentials file unreadable or malformed — fall through to keychain.
    }
  }

  // 2. Fall back to macOS Keychain (Claude Code ≥2.x on macOS)
  if (!loggedIn) {
    try {
      const keychainRaw = await readKeychainCredentials();
      if (keychainRaw) {
        const result = parseOAuthPayload(keychainRaw);
        loggedIn = result.loggedIn;
        expired = result.expired;
        subscriptionType = result.subscriptionType;
        rateLimitTier = result.rateLimitTier;
        expiresAt = result.expiresAt;
      }
    } catch {
      // Keychain read failed — treat as not logged in.
    }
  }

  return { installed, loggedIn, expired, subscriptionType, rateLimitTier, expiresAt, hasAnthropicApiKey };
}
