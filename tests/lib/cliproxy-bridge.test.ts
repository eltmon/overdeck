import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The bridge reads <home>/.codex/auth.json and writes under OVERDECK_HOME;
// both point at a per-test temp dir so no real credential file is touched.
let tempRoot = '';
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => tempRoot };
});

type CliproxyModule = typeof import('../../src/lib/cliproxy.js');
let cliproxy: CliproxyModule;

/** A JWT-shaped token built at runtime, so no token-like literal is committed. */
function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [encode({ alg: 'none', typ: 'JWT' }), encode(claims), 'sig'].join('.');
}

async function writeCodexAuth(accessMarker: string): Promise<string> {
  const accessToken = fakeJwt({ exp: 1_900_000_000, marker: accessMarker });
  const codexDir = join(tempRoot, '.codex');
  mkdirSync(codexDir, { recursive: true });
  await writeFile(join(codexDir, 'auth.json'), JSON.stringify({
    last_refresh: '2026-11-14T00:00:00Z',
    tokens: {
      access_token: accessToken,
      id_token: fakeJwt({ email: 'pool@example.test', exp: 1_900_000_000 }),
      refresh_token: ['refresh', accessMarker].join('-'),
      account_id: 'account-1',
    },
  }));
  return accessToken;
}

function credPath(): string {
  return join(cliproxy.getCliproxyAuthDir(), 'codex-primary.json');
}

async function readCred(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(credPath(), 'utf8')) as Record<string, unknown>;
}

beforeEach(async () => {
  const base = join(tmpdir(), 'pan-5278-cliproxy-bridge');
  mkdirSync(base, { recursive: true });
  tempRoot = mkdtempSync(join(base, 'run-'));
  process.env.OVERDECK_HOME = join(tempRoot, '.overdeck');
  vi.resetModules();
  cliproxy = await import('../../src/lib/cliproxy.js');
  expect(cliproxy.getCliproxyAuthDir().startsWith(tempRoot)).toBe(true);
  mkdirSync(cliproxy.getCliproxyAuthDir(), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('bridgeCodexAuthToCliproxy', () => {
  it('bridge keeps priority, weight and disabled from the existing auth file', async () => {
    await writeCodexAuth('old');
    await expect(cliproxy.bridgeCodexAuthToCliproxy()).resolves.toBe(true);
    const first = await readCred();
    await writeFile(credPath(), JSON.stringify({ ...first, priority: 30, weight: 2, disabled: true }));

    const refreshed = await writeCodexAuth('new');
    await expect(cliproxy.bridgeCodexAuthToCliproxy()).resolves.toBe(true);

    const cred = await readCred();
    expect(cred.access_token).toBe(refreshed);
    expect(cred.priority).toBe(30);
    expect(cred.weight).toBe(2);
    expect(cred.disabled).toBe(true);
  });

  it('bridge drops a non-integer priority', async () => {
    await writeCodexAuth('old');
    await cliproxy.bridgeCodexAuthToCliproxy();
    const first = await readCred();
    await writeFile(credPath(), JSON.stringify({ ...first, priority: 'high', weight: 1.5, disabled: 'yes' }));

    await cliproxy.bridgeCodexAuthToCliproxy();

    const cred = await readCred();
    expect(cred).not.toHaveProperty('priority');
    expect(cred).not.toHaveProperty('weight');
    expect(cred.disabled).toBe(false);
  });

  it('writes disabled false and no priority or weight when no auth file exists yet', async () => {
    const accessToken = await writeCodexAuth('first');

    await expect(cliproxy.bridgeCodexAuthToCliproxy()).resolves.toBe(true);

    const cred = await readCred();
    expect(cred.access_token).toBe(accessToken);
    expect(cred.disabled).toBe(false);
    expect(cred).not.toHaveProperty('priority');
    expect(cred).not.toHaveProperty('weight');
  });

  it('leaves the file untouched when the merged credentials are unchanged', async () => {
    await writeCodexAuth('same');
    await cliproxy.bridgeCodexAuthToCliproxy();
    const withPriority = `${JSON.stringify({ ...(await readCred()), priority: 20 }, null, 2)}\n`;
    await writeFile(credPath(), withPriority);

    await expect(cliproxy.bridgeCodexAuthToCliproxy()).resolves.toBe(true);

    expect(await readFile(credPath(), 'utf8')).toBe(withPriority);
  });
});
