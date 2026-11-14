import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateManagementKey,
  readConfigExtraFile,
  readManagementKeyFile,
  writeCliproxyConfig,
  writeManagementKeyFile,
} from '../../src/lib/cliproxy-config-files.js';
import { parse as parseYaml } from 'yaml';

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

describe('writeCliproxyConfig', () => {
  function opts(log = vi.fn()) {
    return {
      configPath: join(dir, 'config.yaml'),
      extraPath: join(dir, 'config.extra.yaml'),
      keyPath: join(dir, 'management-key'),
      host: '127.0.0.1',
      port: 18317,
      clientToken: 'overdeck-local-cliproxy-key',
      authDir: join(dir, 'auth'),
      geminiApiKey: null,
      log,
    };
  }

  it('creates the management key file with mode 0600 when missing and reuses it after', async () => {
    const first = await writeCliproxyConfig(opts());
    expect(first.wrote).toBe(true);
    expect((await stat(join(dir, 'management-key'))).mode & 0o777).toBe(0o600);
    expect(await readManagementKeyFile(join(dir, 'management-key'))).toBe(first.activeManagementKey);

    const second = await writeCliproxyConfig(opts());
    expect(second.activeManagementKey).toBe(first.activeManagementKey);
    expect(second.wrote).toBe(false);
    const config = parseYaml(await readFile(join(dir, 'config.yaml'), 'utf8')) as Record<string, any>;
    expect(config['config-version']).toBe(8);
    expect(config.management['secret-key']).toBe(first.activeManagementKey);
  });

  it('writes config.yaml with mode 0600 and tightens an existing 0664 file', async () => {
    const configPath = join(dir, 'config.yaml');
    await writeFile(configPath, 'port: 8317\n', { mode: 0o664 });
    expect((await stat(configPath)).mode & 0o777).not.toBe(0o600);
    const result = await writeCliproxyConfig(opts());
    expect(result.wrote).toBe(true);
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
  });

  it('does not rewrite config.yaml after cliproxy hashed the secret-key', async () => {
    const configPath = join(dir, 'config.yaml');
    await writeCliproxyConfig(opts());
    const text = await readFile(configPath, 'utf8');
    const hashed = text.replace(/secret-key: .*/, 'secret-key: $2a$10$abcdefghijklmnopqrstuv');
    expect(hashed).not.toBe(text);
    await writeFile(configPath, hashed);

    const again = await writeCliproxyConfig(opts());
    expect(again.wrote).toBe(false);
    expect(await readFile(configPath, 'utf8')).toBe(hashed);
  });

  it('extra plaintext secret-key is written back to the key file', async () => {
    await writeManagementKeyFile(join(dir, 'management-key'), 'old-file-key');
    await writeFile(join(dir, 'config.extra.yaml'), 'remote-management:\n  secret-key: extra-plain-key\n');
    const result = await writeCliproxyConfig(opts());
    expect(result.activeManagementKey).toBe('extra-plain-key');
    expect(await readManagementKeyFile(join(dir, 'management-key'))).toBe('extra-plain-key');
  });

  it('logs builder warnings with the cliproxy prefix', async () => {
    const log = vi.fn();
    await writeFile(join(dir, 'config.extra.yaml'), 'management:\n  secret-key: $2a$10$abcdefghijklmnopqrstuv\n');
    await writeCliproxyConfig(opts(log));
    expect(log).toHaveBeenCalledWith(
      '[cliproxy] config.extra.yaml management secret-key is a bcrypt hash; using the key in management-key instead',
    );
  });
});
