import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { displayPath, remoteEnabledHint, configYamlSetsRemoteEnabled } from '../remote-enabled.js';

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
});
