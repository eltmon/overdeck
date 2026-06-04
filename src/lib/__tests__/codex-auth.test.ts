import { describe, it, expect } from 'vitest';
import { evaluateBurnedFromLog } from '../codex-auth.js';
import type { CodexAuthStatus } from '../codex-auth.js';

/**
 * Regression tests for the Codex "burned token" detection (PAN-1584).
 *
 * The detection heuristic has been re-tuned repeatedly without a test
 * (938d3e007, 9a8966e0a, 5e1317256, dd99ba3f5, b57c21603). The specific bug
 * these lock in: a burned token was reported "valid" because the burn log line
 * had aged past the 1h staleness window during a quiet period — so no banner,
 * no spawn guard, and gpt-5.5 agents spawned straight into 503s.
 */

const EMAIL = 'user@example.com';
const EXPIRES = '2026-06-12T00:00:00.000Z';
const VALID: CodexAuthStatus = { status: 'valid', email: EMAIL, expiresAt: EXPIRES };

const ms = (iso: string) => Date.parse(iso);

// ── cliproxy log line builders (match the real gin_logger / openai_auth format) ──
const burnBlock = (ts: string) =>
  `[${ts}] [--------] [warn ] [openai_auth.go:295] Token refresh attempt 1 failed with non-retryable error: token refresh failed with status 401: {\n` +
  `    "message": "Your refresh token has already been used to generate a new access token. Please try signing in again.",\n` +
  `    "code": "refresh_token_reused"\n  }`;
const fail503 = (ts: string) =>
  `[${ts}] [0b68fa22] [error] [gin_logger.go:97] 503 |           2ms |       127.0.0.1 | POST    "/v1/messages?beta=true"`;
const ok200 = (ts: string) =>
  `[${ts}] [8fc5f2a5] [info ] [gin_logger.go:101] 200 |        5.627s |       127.0.0.1 | POST    "/v1/messages?beta=true"`;

const evalLog = (lines: string[], opts: { ignoreBurnBefore?: number; now?: number }) =>
  evaluateBurnedFromLog(lines.join('\n'), VALID, EMAIL, EXPIRES, opts);

describe('evaluateBurnedFromLog', () => {
  it('reports valid when the log shows no auth failures', () => {
    const log = [ok200('2026-06-02 03:00:00'), ok200('2026-06-02 03:05:00')];
    expect(evalLog(log, { now: ms('2026-06-02T03:10:00Z') }).status).toBe('valid');
  });

  it('THE REGRESSION: a stale burn AFTER the last login is authoritative (burned), not dismissed by staleness', () => {
    // Credential last written 2026-05-25; burns happened 2026-06-01 (after login,
    // ~4h before "now"). The old code dismissed this as valid via the 1h window.
    const log = [burnBlock('2026-06-01 23:47:00')];
    const status = evalLog(log, {
      ignoreBurnBefore: ms('2026-05-25T05:06:12Z'),
      now: ms('2026-06-02T03:50:00Z'),
    });
    expect(status.status).toBe('burned');
  });

  it('detects the live 503 symptom (not just the burn line) as burned after login', () => {
    const log = [fail503('2026-06-01 23:46:00')];
    const status = evalLog(log, {
      ignoreBurnBefore: ms('2026-05-25T05:06:12Z'),
      now: ms('2026-06-02T03:50:00Z'),
    });
    expect(status.status).toBe('burned');
  });

  it('reports valid when the only failures predate the last login (re-authed since)', () => {
    const log = [burnBlock('2026-06-01 23:47:00'), fail503('2026-06-01 23:48:00')];
    // Logged in AFTER those failures → current token is fresh.
    const status = evalLog(log, {
      ignoreBurnBefore: ms('2026-06-02T03:57:00Z'),
      now: ms('2026-06-02T04:00:00Z'),
    });
    expect(status.status).toBe('valid');
  });

  it('reports valid when a success follows the last failure (auto-retry won)', () => {
    const log = [burnBlock('2026-06-02 03:40:00'), ok200('2026-06-02 03:41:00')];
    const status = evalLog(log, {
      ignoreBurnBefore: ms('2026-05-25T05:06:12Z'),
      now: ms('2026-06-02T03:42:00Z'),
    });
    expect(status.status).toBe('valid');
  });

  it('without a credential cutoff, a recent failure is burned but a stale one is dismissed', () => {
    const recent = evalLog([burnBlock('2026-06-02 03:30:00')], { now: ms('2026-06-02T03:40:00Z') });
    expect(recent.status).toBe('burned');

    const stale = evalLog([burnBlock('2026-06-02 01:00:00')], { now: ms('2026-06-02T03:40:00Z') });
    expect(stale.status).toBe('valid'); // > 1h old, no cutoff → staleness backstop
  });
});
