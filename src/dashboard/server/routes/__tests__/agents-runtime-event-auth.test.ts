import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateAgentRuntimeEventAuth } from '../agents/shared.js';
import { getOverdeckHome } from '../../../../lib/paths.js';

const INTERNAL_TOKEN_HEADER = 'x-overdeck-internal-token';

function tokenFilePath(): string {
  return join(getOverdeckHome(), 'internal-token');
}

function requestWithToken(token?: string) {
  return HttpServerRequest.fromWeb(new Request('http://localhost/api/internal/pipeline/notify', {
    method: 'POST',
    headers: token ? { [INTERNAL_TOKEN_HEADER]: token } : {},
  }));
}

beforeEach(() => {
  rmSync(tokenFilePath(), { force: true });
  delete process.env.OVERDECK_INTERNAL_TOKEN;
});

describe('validateAgentRuntimeEventAuth', () => {
  it('accepts the file token and rejects a stale env token when a file exists', async () => {
    mkdirSync(getOverdeckHome(), { recursive: true });
    writeFileSync(tokenFilePath(), 'file-token\n');
    process.env.OVERDECK_INTERNAL_TOKEN = 'stale-token';

    const accepted = await validateAgentRuntimeEventAuth(requestWithToken('file-token'));
    expect(accepted).toEqual({ ok: true });

    const rejected = await validateAgentRuntimeEventAuth(requestWithToken('stale-token'));
    expect(rejected.ok).toBe(false);
    expect(rejected.response?.status).toBe(403);
  });

  it('falls back to the env token when no file exists', async () => {
    process.env.OVERDECK_INTERNAL_TOKEN = 'env-token';

    const accepted = await validateAgentRuntimeEventAuth(requestWithToken('env-token'));
    expect(accepted).toEqual({ ok: true });
  });

  it('returns 503 when neither a file nor an env token is present', async () => {
    const result = await validateAgentRuntimeEventAuth(requestWithToken('anything'));

    expect(result.ok).toBe(false);
    expect(result.response?.status).toBe(503);
  });
});
