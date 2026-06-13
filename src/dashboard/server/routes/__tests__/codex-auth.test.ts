import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCliproxy = vi.hoisted(() => ({
  authDir: '',
  logPath: '',
}));

vi.mock('../../../../lib/cliproxy.js', async () => {
  const { Effect } = await import('effect');
  return {
    bridgeCodexAuthToCliproxy: () => Effect.succeed(false),
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
  };
});

import { codexAuthRouteLayer } from '../codex-auth.js';

const EMAIL = 'user@example.com';
const NOW = '2026-06-02T03:40:00.000Z';
const LAST_LOGIN = '2026-05-25T05:06:12.000Z';

const ms = (iso: string) => Date.parse(iso);
const base64urlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwtWithClaims = (claims: Record<string, unknown>) =>
  `${base64urlJson({ alg: 'none', typ: 'JWT' })}.${base64urlJson(claims)}.signature`;

const reusedCodeBurnBlock = (ts: string) =>
  `[${ts}] [--------] [warn ] [openai_auth.go:295] Token refresh attempt 1 failed with non-retryable error: token refresh failed with status 401: {\n` +
  `    "code": "refresh_token_reused"\n  }`;

let tmpRoot = '';

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  tmpRoot = await mkdtemp(join(tmpdir(), 'pan-codex-auth-route-'));
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

async function getCodexAuth() {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/settings/codex-auth'));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(codexAuthRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

describe('GET /api/settings/codex-auth', () => {
  it('returns burned when a future-expiring JWT has a fresh refresh_token_reused log tail', async () => {
    await writeCodexFixture([reusedCodeBurnBlock('2026-06-02 03:30:00')]);

    const result = await getCodexAuth();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: 'burned',
      email: EMAIL,
      expiresAt: '2026-06-02T04:40:00.000Z',
    });
  });

  it('returns valid for the same future-expiring JWT when the log tail has no burn lines', async () => {
    await writeCodexFixture();

    const result = await getCodexAuth();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: 'valid',
      email: EMAIL,
      expiresAt: '2026-06-02T04:40:00.000Z',
    });
  });
});
