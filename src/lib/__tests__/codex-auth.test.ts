import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCodexAuthStatus, evaluateBurnedFromLog } from '../codex-auth.js';
import type { CodexAuthStatus } from '../codex-auth.js';

const mockCliproxy = vi.hoisted(() => ({
  authDir: '',
  logPath: '',
}));

vi.mock('../cliproxy.js', () => ({
  decodeJwtPayload: (token: string): Record<string, unknown> | null => {
    const payload = token.split('.')[1];
    if (!payload) return null;
    try {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  },
  getCliproxyAuthDir: () => mockCliproxy.authDir,
  getCliproxyLogPath: () => mockCliproxy.logPath,
}));

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
const NOW = '2026-06-02T03:40:00.000Z';
const LAST_LOGIN = '2026-05-25T05:06:12.000Z';

const ms = (iso: string) => Date.parse(iso);

// ── cliproxy log line builders (match the real gin_logger / openai_auth format) ──
const proseBurnBlock = (ts: string) =>
  `[${ts}] [--------] [warn ] [openai_auth.go:295] Token refresh attempt 1 failed with non-retryable error: token refresh failed with status 401: {\n` +
  `    "message": "Your refresh token has already been used to generate a new access token. Please try signing in again."\n  }`;
const reusedCodeBurnBlock = (ts: string) =>
  `[${ts}] [--------] [warn ] [openai_auth.go:295] Token refresh attempt 1 failed with non-retryable error: token refresh failed with status 401: {\n` +
  `    "code": "refresh_token_reused"\n  }`;
const fail503 = (ts: string) =>
  `[${ts}] [0b68fa22] [error] [gin_logger.go:97] 503 |           2ms |       127.0.0.1 | POST    "/v1/messages?beta=true"`;
const ok200 = (ts: string) =>
  `[${ts}] [8fc5f2a5] [info ] [gin_logger.go:101] 200 |        5.627s |       127.0.0.1 | POST    "/v1/messages?beta=true"`;

const evalLog = (lines: string[], opts: { ignoreBurnBefore?: number; now?: number }) =>
  evaluateBurnedFromLog(lines.join('\n'), VALID, EMAIL, EXPIRES, opts);

const base64urlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwtWithClaims = (claims: Record<string, unknown>) =>
  `${base64urlJson({ alg: 'none', typ: 'JWT' })}.${base64urlJson(claims)}.signature`;

let tmpRoot = '';

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  tmpRoot = await mkdtemp(join(tmpdir(), 'pan-codex-auth-'));
  mockCliproxy.authDir = join(tmpRoot, 'auth');
  mockCliproxy.logPath = join(tmpRoot, 'cliproxy.log');
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(tmpRoot, { recursive: true, force: true });
  tmpRoot = '';
  mockCliproxy.authDir = '';
  mockCliproxy.logPath = '';
});

const writeCodexFixture = async (logLines: string[] = []) => {
  await mkdir(mockCliproxy.authDir, { recursive: true });
  const credentialPath = join(mockCliproxy.authDir, 'codex-primary.json');
  await writeFile(
    credentialPath,
    JSON.stringify({
      access_token: jwtWithClaims({ exp: Math.floor(ms('2026-06-02T04:40:00Z') / 1000) }),
      email: EMAIL,
    }, null, 2),
  );
  const loginTime = new Date(LAST_LOGIN);
  await utimes(credentialPath, loginTime, loginTime);
  await writeFile(mockCliproxy.logPath, logLines.join('\n'));
};

const readCodexStatus = () => Effect.runPromise(checkCodexAuthStatus());

describe('checkCodexAuthStatus', () => {
  it('reports missing when the cliproxy codex credential file is absent', async () => {
    await expect(readCodexStatus()).resolves.toEqual({ status: 'missing' });
  });

  it('reports valid for a future-expiring JWT when the log shows no auth failures', async () => {
    await writeCodexFixture();

    await expect(readCodexStatus()).resolves.toEqual({
      status: 'valid',
      email: EMAIL,
      expiresAt: '2026-06-02T04:40:00.000Z',
    });
  });

  it('reports burned for the PAN-913 prose burn phrasing', async () => {
    await writeCodexFixture([proseBurnBlock('2026-06-02 03:30:00')]);

    await expect(readCodexStatus()).resolves.toMatchObject({ status: 'burned', email: EMAIL });
  });

  it('reports burned for the PAN-1455 refresh_token_reused code shape', async () => {
    await writeCodexFixture([reusedCodeBurnBlock('2026-06-02 03:30:00')]);

    await expect(readCodexStatus()).resolves.toMatchObject({ status: 'burned', email: EMAIL });
  });

  it('reports valid when a refresh_token_reused failure is followed by a successful message request', async () => {
    await writeCodexFixture([
      reusedCodeBurnBlock('2026-06-02 03:30:00'),
      ok200('2026-06-02 03:31:00'),
    ]);

    await expect(readCodexStatus()).resolves.toMatchObject({ status: 'valid', email: EMAIL });
  });
});

describe('evaluateBurnedFromLog', () => {
  it('reports valid when the log shows no auth failures', () => {
    const log = [ok200('2026-06-02 03:00:00'), ok200('2026-06-02 03:05:00')];
    expect(evalLog(log, { now: ms('2026-06-02T03:10:00Z') }).status).toBe('valid');
  });

  it('THE REGRESSION: a stale burn AFTER the last login is authoritative (burned), not dismissed by staleness', () => {
    // Credential last written 2026-05-25; burns happened 2026-06-01 (after login,
    // ~4h before "now"). The old code dismissed this as valid via the 1h window.
    const log = [reusedCodeBurnBlock('2026-06-01 23:47:00')];
    const status = evalLog(log, {
      ignoreBurnBefore: ms('2026-05-25T05:06:12Z'),
      now: ms('2026-06-02T03:50:00Z'),
    });
    expect(status.status).toBe('burned');
  });

  it('detects the PAN-913 prose burn phrasing as burned after login', () => {
    const log = [proseBurnBlock('2026-06-02 03:30:00')];
    const status = evalLog(log, {
      ignoreBurnBefore: ms('2026-05-25T05:06:12Z'),
      now: ms('2026-06-02T03:40:00Z'),
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
    const log = [reusedCodeBurnBlock('2026-06-01 23:47:00'), fail503('2026-06-01 23:48:00')];
    // Logged in AFTER those failures → current token is fresh.
    const status = evalLog(log, {
      ignoreBurnBefore: ms('2026-06-02T03:57:00Z'),
      now: ms('2026-06-02T04:00:00Z'),
    });
    expect(status.status).toBe('valid');
  });

  it('reports valid when a success follows the last failure (auto-retry won)', () => {
    const log = [reusedCodeBurnBlock('2026-06-02 03:40:00'), ok200('2026-06-02 03:41:00')];
    const status = evalLog(log, {
      ignoreBurnBefore: ms('2026-05-25T05:06:12Z'),
      now: ms('2026-06-02T03:42:00Z'),
    });
    expect(status.status).toBe('valid');
  });

  it('without a credential cutoff, a recent failure is burned but a stale one is dismissed', () => {
    const recent = evalLog([reusedCodeBurnBlock('2026-06-02 03:30:00')], { now: ms('2026-06-02T03:40:00Z') });
    expect(recent.status).toBe('burned');

    const stale = evalLog([reusedCodeBurnBlock('2026-06-02 01:00:00')], { now: ms('2026-06-02T03:40:00Z') });
    expect(stale.status).toBe('valid'); // > 1h old, no cutoff → staleness backstop
  });
});
