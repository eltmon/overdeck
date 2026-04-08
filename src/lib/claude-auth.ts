/**
 * claude-auth.ts
 *
 * Reads Claude Code's local credentials file to determine whether the user
 * is logged in with a subscription (MAX / Pro) or not.
 *
 * The credentials live at ~/.claude/.credentials.json and contain:
 *   claudeAiOauth.subscriptionType  — "max" | "pro" | null
 *   claudeAiOauth.rateLimitTier     — e.g. "default_claude_max_20x"
 *   claudeAiOauth.accessToken       — OAuth bearer token
 *   claudeAiOauth.expiresAt         — Unix timestamp (ms)
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export interface ClaudeAuthStatus {
  /** True if the ~/.claude directory exists (i.e. Claude Code has been installed). */
  installed: boolean;
  /** True if a non-expired OAuth token is present. */
  loggedIn: boolean;
  /** True if the token exists but has already expired. */
  expired: boolean;
  /** "max" | "pro" | null — from claudeAiOauth.subscriptionType */
  subscriptionType: string | null;
  /** e.g. "default_claude_max_20x" */
  rateLimitTier: string | null;
  /** Token expiry timestamp in ms, or null if unknown. */
  expiresAt: number | null;
  /** True when ANTHROPIC_API_KEY is set in the server process environment.
   *  When present, Claude Code prefers this over subscription auth. */
  hasAnthropicApiKey: boolean;
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

  if (existsSync(credPath)) {
    try {
      const raw = await readFile(credPath, 'utf-8');
      const creds = JSON.parse(raw) as Record<string, unknown>;
      const oauth = (creds.claudeAiOauth ?? {}) as Record<string, unknown>;

      if (oauth.accessToken) {
        expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null;
        const now = Date.now();
        expired = !!(expiresAt && expiresAt < now);
        // Treat as logged in if an access token exists — Claude Code auto-refreshes
        // expired tokens transparently. Only mark as not-logged-in if there's no
        // token at all. The dashboard doesn't make API calls itself, so an expired
        // token doesn't affect functionality.
        loggedIn = true;
        subscriptionType = typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null;
        rateLimitTier = typeof oauth.rateLimitTier === 'string' ? oauth.rateLimitTier : null;
      }
    } catch {
      // Credentials file unreadable or malformed — treat as not logged in.
    }
  }

  return { installed, loggedIn, expired, subscriptionType, rateLimitTier, expiresAt, hasAnthropicApiKey };
}
