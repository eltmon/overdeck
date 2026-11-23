import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCodexAuthStatus, evaluateBurnedFromLog } from '../codex-auth.js';
import type { CodexAuthStatus } from '../codex-auth.js';
import type { CodexAuthFailure } from '../conversations/codex-thread-status.js';

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
// PAN-3528: the openai_auth.go line the burn JSON hangs off. On a revocation
// whose body carries neither of the phrases above, this is the only evidence.
const nonRetryable401Block = (ts: string) =>
  `[${ts}] [--------] [warn ] [openai_auth.go:317] Token refresh attempt 1 failed with non-retryable error: token refresh failed with status 401: {\n` +
  `    "error": "invalid_grant"\n  }`;
/** Format an epoch as cliproxy's log stamp — which is LOCAL time (PAN-3528). */
const localStamp = (epochMs: number) => {
  const d = new Date(epochMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
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

const writeExpiredCliproxyFixture = async (extra: Record<string, unknown>, logLines: string[] = []) => {
  await mkdir(mockCliproxy.authDir, { recursive: true });
  const credentialPath = join(mockCliproxy.authDir, 'codex-primary.json');
  await writeFile(
    credentialPath,
    JSON.stringify({
      access_token: jwtWithClaims({ exp: Math.floor(ms('2026-06-01T00:00:00Z') / 1000) }),
      email: EMAIL,
      ...extra,
    }, null, 2),
  );
  const loginTime = new Date(LAST_LOGIN);
  await utimes(credentialPath, loginTime, loginTime);
  await writeFile(mockCliproxy.logPath, logLines.join('\n'));
};

const readCodexStatus = () => checkCodexAuthStatus();

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

  it('reports expired for a lapsed cliproxy access token with no refresh token', async () => {
    await writeExpiredCliproxyFixture({});

    await expect(readCodexStatus()).resolves.toMatchObject({ status: 'expired', source: 'cliproxy' });
  });

  it('reports valid for a lapsed cliproxy access token with a refresh token (CLIProxyAPI refreshes it)', async () => {
    await writeExpiredCliproxyFixture({ refresh_token: 'rt_abc' });

    await expect(readCodexStatus()).resolves.toMatchObject({
      status: 'valid',
      email: EMAIL,
      expiresAt: '2026-06-01T00:00:00.000Z',
    });
  });

  it('still reports burned for a lapsed but refreshable cliproxy token when the log shows a burn', async () => {
    await writeExpiredCliproxyFixture({ refresh_token: 'rt_abc' }, [reusedCodeBurnBlock('2026-06-02 03:30:00')]);

    await expect(readCodexStatus()).resolves.toMatchObject({ status: 'burned', source: 'cliproxy' });
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
    // PAN-3528: the staleness backstop compares a LOCAL-time log stamp against
    // `now`, so build both stamps from the same epoch — a literal string would
    // make this assertion pass or fail depending on the host's UTC offset.
    const now = ms('2026-06-02T03:40:00Z');
    const recent = evalLog([reusedCodeBurnBlock(localStamp(now - 10 * 60_000))], { now });
    expect(recent.status).toBe('burned');

    const stale = evalLog([reusedCodeBurnBlock(localStamp(now - 160 * 60_000))], { now });
    expect(stale.status).toBe('valid'); // > 1h old, no cutoff → staleness backstop
  });
});

/**
 * PAN-3528 — the live 2026-08-03 case: every gpt-5.6-sol agent 503'd for hours
 * while GET /api/settings/codex-auth kept answering {status: valid}. Two holes,
 * both locked in here.
 */
describe('evaluateBurnedFromLog CLIProxy-route coverage (PAN-3528)', () => {
  const originalTz = process.env.TZ;
  beforeEach(() => { process.env.TZ = 'America/New_York'; });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('THE REGRESSION: a failure logged seconds after the credential write is burned in a UTC-4 zone', () => {
    // Real shape: cliproxy re-bridged the credential at 19:59:32 local, the
    // refresh 401'd at 19:59:34 local, and 503s ran until 21:25. Parsing the
    // stamps as UTC made every one of them look 4h OLDER than the credential
    // write, so they fell before the cutoff and were dismissed as "re-authed
    // since" — the token was dead and the banner never fired.
    const credWriteMs = new Date(2026, 7, 3, 19, 59, 32).getTime();
    const status = evalLog(
      [nonRetryable401Block('2026-08-03 19:59:34'), fail503('2026-08-03 21:25:03')],
      { ignoreBurnBefore: credWriteMs, now: new Date(2026, 7, 3, 21, 30, 0).getTime() },
    );

    expect(status.status).toBe('burned');
  });

  it('still dismisses failures that genuinely predate the credential write', () => {
    // Same zone — the cutoff must keep working, not just always report burned.
    const credWriteMs = new Date(2026, 7, 3, 20, 0, 0).getTime();
    const status = evalLog([fail503('2026-08-03 17:10:00')], {
      ignoreBurnBefore: credWriteMs,
      now: new Date(2026, 7, 3, 21, 30, 0).getTime(),
    });

    expect(status.status).toBe('valid');
  });

  it('treats a non-retryable 401 refresh failure as burned even when the body names no known code', () => {
    // Fires at cliproxy startup, before any agent has made a request — earlier
    // and more definitive than the 503 symptom.
    const status = evalLog([nonRetryable401Block('2026-08-03 19:59:34')], {
      ignoreBurnBefore: new Date(2026, 7, 3, 19, 0, 0).getTime(),
      now: new Date(2026, 7, 3, 20, 0, 0).getTime(),
    });

    expect(status.status).toBe('burned');
  });
});

// ─── PAN-2285: native store probe and combine; PAN-5633: failed-turn signal ────

import {
  activeCodexAuthFailures,
  assertCodexNativeAuthForSpawn,
  classifyNativeCodexAuth,
  combineCodexAuthStatuses,
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

  it('reports expired for a past-exp access token with no refresh token', () => {
    const raw = JSON.stringify({
      tokens: { access_token: makeJwt({ exp: Math.floor(now / 1000) - 60 }) },
    });
    expect(classifyNativeCodexAuth(raw, now).status).toBe('expired');
  });

  it('reports expired for a past-exp access token whose refresh token is empty', () => {
    const raw = JSON.stringify({
      tokens: { access_token: makeJwt({ exp: Math.floor(now / 1000) - 60 }), refresh_token: '' },
    });
    expect(classifyNativeCodexAuth(raw, now).status).toBe('expired');
  });

  it('reports valid for a past-exp access token with a refresh token (codex refreshes it itself)', () => {
    const raw = JSON.stringify({
      tokens: {
        access_token: makeJwt({ exp: Math.floor(now / 1000) - 11 * 24 * 3600 }),
        refresh_token: 'rt_abc',
        id_token: makeJwt({ email: 'user@example.com' }),
      },
    });
    const res = classifyNativeCodexAuth(raw, now);
    expect(res.status).toBe('valid');
    expect(res.email).toBe('user@example.com');
  });

  it('treats API-key mode (OPENAI_API_KEY set, no OAuth tokens) as valid', () => {
    const raw = JSON.stringify({ OPENAI_API_KEY: 'sk-abc', tokens: {} });
    expect(classifyNativeCodexAuth(raw, now).status).toBe('valid');
  });

  it('reports unknown when there is neither an OAuth token nor an API key', () => {
    expect(classifyNativeCodexAuth(JSON.stringify({ tokens: {} }), now).status).toBe('unknown');
  });
});



describe('failed-turn burn signal (PAN-5633)', () => {
  // NOW is 2026-06-02T03:40:00Z (fake timers); the last `codex login` was ten minutes before.
  const SIGNED_IN = ms('2026-06-02T03:30:00Z');

  const failure = (id: string, at: string): CodexAuthFailure => ({ id, at, message: 'refresh token was already used' });

  /** A valid native ~/.codex/auth.json (HOME is the temp root) last written at SIGNED_IN. */
  const writeNativeAuth = async () => {
    const dir = join(tmpRoot, '.codex');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'auth.json');
    await writeFile(path, JSON.stringify({
      tokens: {
        access_token: makeJwt({ exp: Math.floor(ms(NOW) / 1000) + 3600 }),
        refresh_token: 'rt_abc',
        id_token: makeJwt({ email: EMAIL }),
      },
    }));
    await utimes(path, new Date(SIGNED_IN), new Date(SIGNED_IN));
  };

  it('activeCodexAuthFailures keeps failures at or after the native write and drops older ones', () => {
    const before = failure('conv-old', '2026-06-02T03:29:59.000Z');
    const atWrite = failure('conv-at', '2026-06-02T03:30:00.000Z');
    const after = failure('conv-new', '2026-06-02T03:35:00.000Z');
    const undated = failure('conv-undated', '');
    expect(activeCodexAuthFailures([before, atWrite, after, undated], SIGNED_IN).map((f) => f.id)).toEqual(['conv-at', 'conv-new']);
  });

  it('checkCodexAuthStatus returns burned with affectedAgents for an active auth failure', async () => {
    await writeNativeAuth();
    const status = await checkCodexAuthStatus({ authFailures: [failure('conv-20261118-427e', '2026-06-02T03:35:00.000Z')] });
    expect(status).toMatchObject({ status: 'burned', source: 'native', email: EMAIL, affectedAgents: ['conv-20261118-427e'] });
  });

  it('checkCodexAuthStatus ignores a failure older than auth.json', async () => {
    await writeNativeAuth();
    const status = await checkCodexAuthStatus({ authFailures: [failure('conv-20261118-427e', '2026-06-02T03:20:00.000Z')] });
    expect(status.status).toBe('valid');
    expect(status.source).toBe('native');
  });

  it('assertCodexNativeAuthForSpawn rejects a codex spawn while an active auth failure exists', async () => {
    await writeNativeAuth();
    await expect(assertCodexNativeAuthForSpawn('codex', async () => [failure('agent-pan-1', '2026-06-02T03:35:00.000Z')]))
      .rejects.toThrow(/revoked \(a running Codex session failed a turn on sign-in/);
    await expect(assertCodexNativeAuthForSpawn('codex', async () => [failure('agent-pan-1', '2026-06-02T03:20:00.000Z')]))
      .resolves.toBeUndefined();
  });

  it('assertCodexNativeAuthForSpawn does not call the loader for a non-codex harness', async () => {
    const load = vi.fn(async () => [failure('agent-pan-1', '2026-06-02T03:35:00.000Z')]);
    await expect(assertCodexNativeAuthForSpawn('claude-code', load)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
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
