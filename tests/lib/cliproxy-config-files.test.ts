import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateManagementKey,
  readConfigExtraFile,
  readManagementKeyFile,
  writeManagementKeyFile,
} from '../../src/lib/cliproxy-config-files.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pan-cliproxy-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('management key file', () => {
  it('reads a trimmed management key and returns null when missing or empty', async () => {
    const keyPath = join(dir, 'management-key');
    expect(await readManagementKeyFile(keyPath)).toBeNull();
    await writeFile(keyPath, '');
    expect(await readManagementKeyFile(keyPath)).toBeNull();
    await writeFile(keyPath, 'abc\n');
    expect(await readManagementKeyFile(keyPath)).toBe('abc');
  });

  it('writes the management key file with mode 0600', async () => {
    const keyPath = join(dir, 'management-key');
    await writeFile(keyPath, 'old', { mode: 0o664 });
    await writeManagementKeyFile(keyPath, 'new-key');
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect(await readManagementKeyFile(keyPath)).toBe('new-key');
  });

  it('generates a 32-character base64url key', () => {
    const key = generateManagementKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(generateManagementKey()).not.toBe(key);
  });
});

describe('readConfigExtraFile', () => {
  it('invalid extra YAML is ignored with a log line', async () => {
    const extraPath = join(dir, 'config.extra.yaml');
    await writeFile(extraPath, 'not: [valid');
    const log = vi.fn();
    expect(await readConfigExtraFile(extraPath, log)).toEqual({});
    expect(log).toHaveBeenCalledWith('[cliproxy] config.extra.yaml is not valid YAML; ignoring it');
  });

  it('a non-mapping extra file is ignored with a log line', async () => {
    const extraPath = join(dir, 'config.extra.yaml');
    await writeFile(extraPath, '- one\n- two\n');
    const log = vi.fn();
    expect(await readConfigExtraFile(extraPath, log)).toEqual({});
    expect(log).toHaveBeenCalledWith('[cliproxy] config.extra.yaml is not a YAML mapping; ignoring it');
  });

  it('returns {} for a missing or whitespace-only file and parses a mapping', async () => {
    const extraPath = join(dir, 'config.extra.yaml');
    const log = vi.fn();
    expect(await readConfigExtraFile(extraPath, log)).toEqual({});
    await writeFile(extraPath, '  \n');
    expect(await readConfigExtraFile(extraPath, log)).toEqual({});
    await writeFile(extraPath, 'routing:\n  session-affinity-ttl: 2h\n');
    expect(await readConfigExtraFile(extraPath, log)).toEqual({ routing: { 'session-affinity-ttl': '2h' } });
    expect(log).not.toHaveBeenCalled();
  });
});
