import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lineHash } from '../../../../src/lib/vault/continuity.js';
import {
  allowSecret,
  allowedSecretHashes,
  allowedSecretsPath,
  scanNewLines,
} from '../../../../src/lib/vault/secrets.js';

const API_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
const SECRET_LINE = JSON.stringify({ type: 'user', text: `here is my key ${API_KEY}` });
const PLAIN_LINE = JSON.stringify({ type: 'user', text: 'export FOO=bar token: abc' });

describe('vault secrets', () => {
  let root: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-secrets-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('ac1: reports the line number and pattern name without any part of the key', async () => {
    const hits = await scanNewLines('vault-a', [PLAIN_LINE, SECRET_LINE, PLAIN_LINE], 41);
    expect(hits).toEqual([{ line: 42, pattern: 'api-key' }]);
    const serialized = JSON.stringify(hits);
    for (let len = 6; len <= API_KEY.length; len++) {
      for (let i = 0; i + len <= API_KEY.length; i++) {
        expect(serialized.includes(API_KEY.slice(i, i + len))).toBe(false);
      }
    }
  });

  it('ac2: an allowed line hash for the same vaultId no longer blocks', async () => {
    await allowSecret('vault-a', lineHash(SECRET_LINE));
    expect(await scanNewLines('vault-a', [SECRET_LINE], 1)).toEqual([]);
    expect(statSync(allowedSecretsPath()).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(allowedSecretsPath(), 'utf8'))).toEqual({ 'vault-a': [lineHash(SECRET_LINE)] });
  });

  it('ac3: an allow entry for a different vaultId still blocks', async () => {
    await allowSecret('vault-b', lineHash(SECRET_LINE));
    expect(await scanNewLines('vault-a', [SECRET_LINE], 7)).toEqual([{ line: 7, pattern: 'api-key' }]);
  });

  it('allowSecret is idempotent and keeps entries for other records', async () => {
    await allowSecret('vault-a', 'h1');
    await allowSecret('vault-a', 'h1');
    await allowSecret('vault-b', 'h2');
    expect([...(await allowedSecretHashes('vault-a'))]).toEqual(['h1']);
    expect([...(await allowedSecretHashes('vault-b'))]).toEqual(['h2']);
    expect([...(await allowedSecretHashes('vault-c'))]).toEqual([]);
  });

  it('reports each pattern once per line and no hits for plain lines', async () => {
    const twoTokens = 'gh ghp_abcdefghijklmnopqrstuvwxyz0123456789 and ghp_zyxwvutsrqponmlkjihgfedcba9876543210 aws AKIAIOSFODNN7EXAMPLE';
    expect(await scanNewLines('v', [twoTokens], 3)).toEqual([
      { line: 3, pattern: 'token' },
      { line: 3, pattern: 'aws-access-key' },
    ]);
    expect(await scanNewLines('v', [PLAIN_LINE, PLAIN_LINE], 1)).toEqual([]);
    expect(await scanNewLines('v', [], 1)).toEqual([]);
  });
});
