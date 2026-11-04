import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  displayPath,
  remoteEnabledHint,
  configYamlSetsRemoteEnabled,
  enableRemoteInConfigToml,
  RemoteEnableError,
} from '../remote-enabled.js';

describe('remote-enabled', () => {
  const dirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'remote-enabled-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  describe('displayPath', () => {
    it('replaces a home-prefixed path with ~', () => {
      const path = join(homedir(), '.overdeck', 'config.toml');
      expect(displayPath(path)).toBe('~/.overdeck/config.toml');
    });

    it('leaves a foreign path untouched', () => {
      expect(displayPath('/x/config.toml')).toBe('/x/config.toml');
    });
  });

  describe('remoteEnabledHint', () => {
    it('names the exact key and path', () => {
      expect(remoteEnabledHint('/x/config.toml')).toBe(
        'add `enabled = true` under `[remote]` in /x/config.toml',
      );
    });
  });

  describe('configYamlSetsRemoteEnabled', () => {
    it('returns true when remote.enabled is present', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.yaml');
      writeFileSync(path, 'remote:\n  enabled: true\n', 'utf8');
      await expect(configYamlSetsRemoteEnabled(path)).resolves.toBe(true);
    });

    it('returns false when remote has only resiliency_tier', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.yaml');
      writeFileSync(path, 'remote:\n  resiliency_tier: durable\n', 'utf8');
      await expect(configYamlSetsRemoteEnabled(path)).resolves.toBe(false);
    });

    it('returns false when the file is missing', async () => {
      const dir = tempDir();
      const path = join(dir, 'missing.yaml');
      await expect(configYamlSetsRemoteEnabled(path)).resolves.toBe(false);
    });

    it('returns false when the file does not parse as valid YAML', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.yaml');
      writeFileSync(path, ':\n  - [unterminated\n', 'utf8');
      await expect(configYamlSetsRemoteEnabled(path)).resolves.toBe(false);
    });
  });

  describe('enableRemoteInConfigToml', () => {
    it('creates [remote] enabled = true when the file is missing', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.toml');
      const result = await enableRemoteInConfigToml(path);
      expect(result).toEqual({ changed: true, path });
      expect(readFileSync(path, 'utf8')).toBe('\n[remote]\nenabled = true\n');
    });

    it('replaces an existing enabled line and preserves comments elsewhere', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.toml');
      writeFileSync(
        path,
        '# top comment\n[other]\nfoo = 1\n\n[remote]\nenabled = false # old\n\n[another]\nbar = 2\n',
        'utf8',
      );
      const result = await enableRemoteInConfigToml(path);
      expect(result).toEqual({ changed: true, path });
      expect(readFileSync(path, 'utf8')).toBe(
        '# top comment\n[other]\nfoo = 1\n\n[remote]\nenabled = true\n\n[another]\nbar = 2\n',
      );
    });

    it('inserts enabled after the header when [remote] lacks it, keeping other keys', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.toml');
      writeFileSync(path, '[remote]\nresiliency_tier = "durable"\n', 'utf8');
      const result = await enableRemoteInConfigToml(path);
      expect(result).toEqual({ changed: true, path });
      expect(readFileSync(path, 'utf8')).toBe('[remote]\nenabled = true\nresiliency_tier = "durable"\n');
    });

    it('appends [remote] when only a subtable like [remote.fly] is present', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.toml');
      writeFileSync(path, '[remote.fly]\napp = "foo"\n', 'utf8');
      const result = await enableRemoteInConfigToml(path);
      expect(result).toEqual({ changed: true, path });
      const text = readFileSync(path, 'utf8');
      expect(text).toBe('[remote.fly]\napp = "foo"\n\n[remote]\nenabled = true\n');
      const parsed = JSON.parse(JSON.stringify((await import('@iarna/toml')).parse(text)));
      expect(parsed.remote.fly.app).toBe('foo');
      expect(parsed.remote.enabled).toBe(true);
    });

    it('is a no-op when remote.enabled is already true', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.toml');
      writeFileSync(path, '[remote]\nenabled = true\n', 'utf8');
      const before = statSync(path).mtimeNs;
      const beforeText = readFileSync(path, 'utf8');
      const result = await enableRemoteInConfigToml(path);
      expect(result).toEqual({ changed: false, path });
      expect(statSync(path).mtimeNs).toBe(before);
      expect(readFileSync(path, 'utf8')).toBe(beforeText);
    });

    it('refuses without writing on an inline remote table', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.toml');
      const text = 'remote = { enabled = false }\n';
      writeFileSync(path, text, 'utf8');
      await expect(enableRemoteInConfigToml(path)).rejects.toBeInstanceOf(RemoteEnableError);
      expect(readFileSync(path, 'utf8')).toBe(text);
    });

    it('refuses without writing on an unparseable file', async () => {
      const dir = tempDir();
      const path = join(dir, 'config.toml');
      const text = 'this is not [ valid toml\n';
      writeFileSync(path, text, 'utf8');
      await expect(enableRemoteInConfigToml(path)).rejects.toBeInstanceOf(RemoteEnableError);
      expect(readFileSync(path, 'utf8')).toBe(text);
    });
  });
});
