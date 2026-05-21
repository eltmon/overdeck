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
import { homedir } from 'os';
import { join } from 'path';
import { platform } from 'process';
import { Duration, Effect, FileSystem } from 'effect';
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import { ChildProcess } from 'effect/unstable/process';
import { layer as NodeServicesLayer } from '@effect/platform-node/NodeServices';
import { ClaudeCredentialParseError } from './errors.js';

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

export function parseOAuthPayload(raw: string): Effect.Effect<
  {
    loggedIn: boolean;
    expired: boolean;
    subscriptionType: string | null;
    rateLimitTier: string | null;
    expiresAt: number | null;
  },
  ClaudeCredentialParseError
> {
  return Effect.try({
    try: () => {
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
    },
    catch: (cause) => new ClaudeCredentialParseError({ message: 'Failed to parse credentials JSON', cause }),
  });
}

/**
 * Read credentials JSON from macOS Keychain.
 * Claude Code ≥2.x stores credentials under service "Claude Code-credentials".
 */
const readKeychainCredentials: Effect.Effect<string | null, never, ChildProcessSpawner> =
  Effect.gen(function* () {
    if (platform !== 'darwin') return null;
    const spawner = yield* ChildProcessSpawner;
    const cmd = ChildProcess.make('security', [
      'find-generic-password', '-s', 'Claude Code-credentials', '-w',
    ]);
    return yield* spawner.string(cmd).pipe(
      Effect.timeout(Duration.seconds(3)),
      Effect.map((s) => s.trim() || null),
      Effect.orElseSucceed(() => null),
    );
  });

const getClaudeAuthStatusImpl: Effect.Effect<
  ClaudeAuthStatus,
  never,
  FileSystem.FileSystem | ChildProcessSpawner
> = Effect.gen(function* () {
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
    const fs = yield* FileSystem.FileSystem;
    const result = yield* fs.readFileString(credPath, 'utf-8').pipe(
      Effect.flatMap(parseOAuthPayload),
      Effect.orElseSucceed(() => null),
    );
    if (result) {
      loggedIn = result.loggedIn;
      expired = result.expired;
      subscriptionType = result.subscriptionType;
      rateLimitTier = result.rateLimitTier;
      expiresAt = result.expiresAt;
    }
  }

  // 2. Fall back to macOS Keychain (Claude Code ≥2.x on macOS)
  if (!loggedIn) {
    const keychainRaw = yield* readKeychainCredentials;
    if (keychainRaw) {
      const result = yield* parseOAuthPayload(keychainRaw).pipe(
        Effect.orElseSucceed(() => null),
      );
      if (result) {
        loggedIn = result.loggedIn;
        expired = result.expired;
        subscriptionType = result.subscriptionType;
        rateLimitTier = result.rateLimitTier;
        expiresAt = result.expiresAt;
      }
    }
  }

  return { installed, loggedIn, expired, subscriptionType, rateLimitTier, expiresAt, hasAnthropicApiKey };
});

export function getClaudeAuthStatus(): Effect.Effect<ClaudeAuthStatus, never> {
  return getClaudeAuthStatusImpl.pipe(
    Effect.scoped,
    Effect.provide(NodeServicesLayer),
  );
}
