import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnvironmentIdentity, readEnvironmentIdentity } from '../environment-identity.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('environment-identity', () => {
  let root: string;
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-env-identity-'));
    home = join(root, '.overdeck');
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('ac1: creates environment-id.json once with mode 0600 and returns a stable id', async () => {
    expect(await readEnvironmentIdentity()).toBeNull();
    const first = await ensureEnvironmentIdentity();
    const second = await ensureEnvironmentIdentity();
    expect(second.environmentId).toBe(first.environmentId);
    expect(first.v).toBe(1);
    expect(first.environmentId).toMatch(UUID_V4);
    expect(typeof first.label).toBe('string');
    expect(new Date(first.createdAt).toISOString()).toBe(first.createdAt);

    const path = join(home, 'environment-id.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(home)).toEqual(['environment-id.json']);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(first);
    expect(await readEnvironmentIdentity()).toEqual(first);
  });

  it('ac2: two OVERDECK_HOMEs get two different UUID v4 values', async () => {
    const a = await ensureEnvironmentIdentity();
    const otherHome = join(root, 'other-home');
    process.env.OVERDECK_HOME = otherHome;
    const b = await ensureEnvironmentIdentity();
    expect(a.environmentId).toMatch(UUID_V4);
    expect(b.environmentId).toMatch(UUID_V4);
    expect(b.environmentId).not.toBe(a.environmentId);
  });

  it('ac3: invalid JSON throws an error naming the file and leaves it unchanged', async () => {
    mkdirSync(home, { recursive: true });
    const path = join(home, 'environment-id.json');
    writeFileSync(path, 'not json {');
    const before = readFileSync(path);

    await expect(readEnvironmentIdentity()).rejects.toThrow(path);
    await expect(ensureEnvironmentIdentity()).rejects.toThrow(path);

    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(home)).toEqual(['environment-id.json']);
  });

  it('valid JSON with the wrong shape also throws naming the file and is never re-minted', async () => {
    mkdirSync(home, { recursive: true });
    const path = join(home, 'environment-id.json');
    writeFileSync(path, JSON.stringify({ v: 2, environmentId: 'NOT-A-UUID' }));
    const before = readFileSync(path);

    await expect(readEnvironmentIdentity()).rejects.toThrow(path);
    await expect(ensureEnvironmentIdentity()).rejects.toThrow(path);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('ac4: never writes machine-id.json', async () => {
    await ensureEnvironmentIdentity();
    await ensureEnvironmentIdentity();
    expect(existsSync(join(home, 'machine-id.json'))).toBe(false);
    expect(readdirSync(home).some((name) => name.includes('machine-id'))).toBe(false);
  });
});
