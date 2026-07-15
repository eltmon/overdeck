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
let originalHome: string | undefined;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  tmpRoot = await mkdtemp(join(tmpdir(), 'pan-codex-auth-'));
  mockCliproxy.authDir = join(tmpRoot, 'auth');
  mockCliproxy.logPath = join(tmpRoot, 'cliproxy.log');
  // PAN-2285: the merged status also probes the native ~/.codex/auth.json.
  // Point HOME at the (empty) temp root so these cliproxy-store tests are not
  // polluted by the developer's real native credential.
  originalHome = process.env.HOME;
  process.env.HOME = tmpRoot;
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(tmpRoot, { recursive: true, force: true });
  tmpRoot = '';
  mockCliproxy.authDir = '';
  mockCliproxy.logPath = '';
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
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
  it('reports missing when both the cliproxy and native codex credential files are absent', async () => {
    await expect(readCodexStatus()).resolves.toMatchObject({ status: 'missing' });
  });

  it('reports valid for a future-expiring JWT when the log shows no auth failures', async () => {
    await writeCodexFixture();

    await expect(readCodexStatus()).resolves.toMatchObject({
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

// ─── PAN-2285: native store probe, pane-burn classifier, registry, combine ─────

import {
  classifyNativeCodexAuth,
  paneShowsCodexAuthBurn,
  applyCodexAuthBurnFlag,
  codexAuthBurnFlaggedAtMs,
  filterCodexAuthBurnedAgentIds,
  combineCodexAuthStatuses,
  CODEX_AUTH_BURNED_REASON_PREFIX,
  type CodexAuthBurnFlagState,
} from '../codex-auth.js';

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.sig`;
}

describe('classifyNativeCodexAuth (PAN-2285)', () => {
  const now = ms('2026-07-14T00:00:00Z');

  it('reports missing when the file is absent (raw === null)', () => {
    expect(classifyNativeCodexAuth(null, now).status).toBe('missing');
  });

  it('reports unknown on malformed JSON', () => {
    expect(classifyNativeCodexAuth('{not json', now).status).toBe('unknown');
  });

  it('reports valid for a future-exp access token and extracts email from the id token', () => {
    const raw = JSON.stringify({
      last_refresh: '2026-07-13T13:49:33Z',
      tokens: {
        access_token: makeJwt({ exp: Math.floor(now / 1000) + 3600 }),
        id_token: makeJwt({ email: 'user@example.com' }),
      },
    });
    const res = classifyNativeCodexAuth(raw, now);
    expect(res.status).toBe('valid');
    expect(res.email).toBe('user@example.com');
    expect(res.lastRefresh).toBe('2026-07-13T13:49:33Z');
  });

  it('reports expired for a past-exp access token', () => {
    const raw = JSON.stringify({
      tokens: { access_token: makeJwt({ exp: Math.floor(now / 1000) - 60 }) },
    });
    expect(classifyNativeCodexAuth(raw, now).status).toBe('expired');
  });

  it('treats API-key mode (OPENAI_API_KEY set, no OAuth tokens) as valid', () => {
    const raw = JSON.stringify({ OPENAI_API_KEY: 'sk-abc', tokens: {} });
    expect(classifyNativeCodexAuth(raw, now).status).toBe('valid');
  });

  it('reports unknown when there is neither an OAuth token nor an API key', () => {
    expect(classifyNativeCodexAuth(JSON.stringify({ tokens: {} }), now).status).toBe('unknown');
  });
});

describe('paneShowsCodexAuthBurn (PAN-2285)', () => {
  it('matches each revoked-token marker', () => {
    expect(paneShowsCodexAuthBurn('… could not be refreshed because your refresh token was revoked')).toBe(true);
    expect(paneShowsCodexAuthBurn('MCP error 401: token_invalidated')).toBe(true);
    expect(paneShowsCodexAuthBurn('error: token_revoked')).toBe(true);
  });

  it('does not match a clean pane', () => {
    expect(paneShowsCodexAuthBurn('❯ working on the task, all good')).toBe(false);
  });
});

describe('persisted codex burn flag (PAN-2285)', () => {
  const FLAG_NOW = ms('2026-07-15T02:00:00Z');

  it('applyCodexAuthBurnFlag flags a fresh state (troubled + stamped reason) once', () => {
    const state: CodexAuthBurnFlagState = {};
    expect(applyCodexAuthBurnFlag(state, FLAG_NOW)).toBe(true);
    expect(state.troubled).toBe(true);
    expect(state.troubledAt).toBe('2026-07-15T02:00:00.000Z');
    expect(state.lastFailureReason).toMatch(/^codex-auth-burned\[2026-07-15T02:00:00\.000Z\]/);
    expect(state.lastFailureAt).toBe('2026-07-15T02:00:00.000Z');
    // Second flag is a no-op — the writer patrol must not re-stamp every tick.
    expect(applyCodexAuthBurnFlag(state, FLAG_NOW + 60_000)).toBe(false);
    expect(state.lastFailureReason).toContain('2026-07-15T02:00:00.000Z');
  });

  it('applyCodexAuthBurnFlag preserves an earlier troubledAt (agent already troubled for another reason)', () => {
    const state: CodexAuthBurnFlagState = { troubled: true, troubledAt: '2026-07-14T00:00:00.000Z', lastFailureReason: 'resume failed' };
    expect(applyCodexAuthBurnFlag(state, FLAG_NOW)).toBe(true);
    expect(state.troubledAt).toBe('2026-07-14T00:00:00.000Z');
    // …which is exactly why the flag time is stamped into the reason instead.
    expect(codexAuthBurnFlaggedAtMs(state)).toBe(FLAG_NOW);
  });

  it('codexAuthBurnFlaggedAtMs returns null once the agent is untroubled (flag must not linger)', () => {
    const state: CodexAuthBurnFlagState = {};
    applyCodexAuthBurnFlag(state, FLAG_NOW);
    // pan untroubled / resume → applyAgentUntroubled clears troubled + failure fields.
    delete state.troubled;
    delete state.troubledAt;
    delete state.lastFailureReason;
    delete state.lastFailureAt;
    expect(codexAuthBurnFlaggedAtMs(state)).toBeNull();
    // And the agent can be flagged again on a later, genuine re-burn.
    expect(applyCodexAuthBurnFlag(state, FLAG_NOW + 1000)).toBe(true);
  });

  it('codexAuthBurnFlaggedAtMs falls back to troubledAt for legacy unstamped reasons', () => {
    const state: CodexAuthBurnFlagState = {
      troubled: true,
      troubledAt: '2026-07-15T01:56:55.000Z',
      lastFailureReason: `${CODEX_AUTH_BURNED_REASON_PREFIX}: Codex refresh token was revoked — re-authenticate`,
    };
    expect(codexAuthBurnFlaggedAtMs(state)).toBe(ms('2026-07-15T01:56:55Z'));
  });

  it('codexAuthBurnFlaggedAtMs ignores troubled agents with unrelated failure reasons', () => {
    expect(codexAuthBurnFlaggedAtMs({ troubled: true, lastFailureReason: 'resume failed 3x' })).toBeNull();
    expect(codexAuthBurnFlaggedAtMs({ troubled: true })).toBeNull();
  });

  it('filterCodexAuthBurnedAgentIds keeps flags at/after the native write and drops stale ones (re-login heals)', () => {
    const burned: CodexAuthBurnFlagState & { id: string } = { id: 'agent-a' };
    applyCodexAuthBurnFlag(burned, FLAG_NOW);
    const healthy: CodexAuthBurnFlagState & { id: string } = { id: 'agent-b' };

    // Native store untouched since the flag → active.
    expect(filterCodexAuthBurnedAgentIds([burned, healthy], FLAG_NOW - 60_000)).toEqual(['agent-a']);
    // Native store rewritten AFTER the flag (global `codex login`) → stale, banner clears.
    expect(filterCodexAuthBurnedAgentIds([burned, healthy], FLAG_NOW + 60_000)).toEqual([]);
  });
});

describe('combineCodexAuthStatuses (PAN-2285)', () => {
  const valid = { status: 'valid', email: '', expiresAt: '' } as CodexAuthStatus;
  const expired = { status: 'expired', email: '', expiresAt: '' } as CodexAuthStatus;
  const burned = { status: 'burned', email: '', expiresAt: '' } as CodexAuthStatus;
  const missing = { status: 'missing' } as CodexAuthStatus;

  it('native valid + cliproxy missing → valid', () => {
    expect(combineCodexAuthStatuses(valid, missing).status).toBe('valid');
  });

  it('native expired + cliproxy valid → expired (banner fires)', () => {
    expect(combineCodexAuthStatuses(expired, valid).status).toBe('expired');
  });

  it('native missing + cliproxy burned → burned (gpt-5.5 path preserved)', () => {
    const res = combineCodexAuthStatuses(missing, burned);
    expect(res.status).toBe('burned');
    expect(res.source).toBe('cliproxy');
  });

  it('both missing → missing (no banner)', () => {
    expect(combineCodexAuthStatuses(missing, missing).status).toBe('missing');
  });
});
