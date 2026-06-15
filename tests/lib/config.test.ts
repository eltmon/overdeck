import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to mock the CONFIG_FILE path before importing config
// This is a simplified test that checks the functions work

describe('config', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-config-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe('getDefaultConfig', () => {
    it('should return default configuration', async () => {
      const { getDefaultConfigSync } = await import('../../src/lib/config.js');
      const config = getDefaultConfigSync();

      expect(config.panopticon.version).toBe('1.0.0');
      expect(config.sync.backup_before_sync).toBe(true);
      expect(config.sync.backup_before_sync).toBe(true);
      expect(config.trackers.primary).toBe('linear');
      expect(config.dashboard.port).toBe(3010);
      expect(config.dashboard.api_port).toBe(3011);
    });

    it('should include default traefik config', async () => {
      const { getDefaultConfigSync } = await import('../../src/lib/config.js');
      const config = getDefaultConfigSync();

      expect(config.traefik).toBeDefined();
      expect(config.traefik.enabled).toBe(false);
      expect(config.traefik.dashboard_port).toBe(8080);
      expect(config.traefik.domain).toBe('pan.localhost');
    });

    it('should include default Linear config', async () => {
      const { getDefaultConfigSync } = await import('../../src/lib/config.js');
      const config = getDefaultConfigSync();

      expect(config.trackers.linear).toBeDefined();
      expect(config.trackers.linear?.type).toBe('linear');
      expect(config.trackers.linear?.api_key_env).toBe('LINEAR_API_KEY');
    });
  });

  describe('PanopticonConfig type', () => {
    it('should have all required sections', async () => {
      const { getDefaultConfigSync } = await import('../../src/lib/config.js');
      const config = getDefaultConfigSync();

      // Type checking - these should all exist
      expect(config.panopticon).toBeDefined();
      expect(config.sync).toBeDefined();
      expect(config.trackers).toBeDefined();
      expect(config.dashboard).toBeDefined();
      expect(config.traefik).toBeDefined();
    });
  });

  describe('TrackersConfig type', () => {
    it('should support primary and secondary trackers', async () => {
      const { getDefaultConfigSync } = await import('../../src/lib/config.js');
      const config = getDefaultConfigSync();

      // Primary is required
      expect(config.trackers.primary).toBeDefined();

      // Secondary is optional
      expect(config.trackers.secondary).toBeUndefined();
    });

    it('should support optional tracker configs', async () => {
      const { getDefaultConfigSync } = await import('../../src/lib/config.js');
      const config = getDefaultConfigSync();

      // These are optional
      expect(config.trackers.linear).toBeDefined();
      expect(config.trackers.github).toBeUndefined();
      expect(config.trackers.gitlab).toBeUndefined();
    });
  });

  describe('normalizeRemoteConfig', () => {
    it('defaults resiliency_tier to ephemeral when unset', async () => {
      const { getDefaultConfigSync, normalizeRemoteConfig } = await import('../../src/lib/config.js');
      const config = getDefaultConfigSync();
      delete (config.remote as { resiliency_tier?: string }).resiliency_tier;
      normalizeRemoteConfig(config);
      expect(config.remote?.resiliency_tier).toBe('ephemeral');
    });

    it('preserves a valid durable tier', async () => {
      const { getDefaultConfigSync, normalizeRemoteConfig } = await import('../../src/lib/config.js');
      const config = getDefaultConfigSync();
      config.remote = { enabled: true, resiliency_tier: 'durable', max_concurrent_agents: 5 };
      normalizeRemoteConfig(config);
      expect(config.remote.resiliency_tier).toBe('durable');
      expect(config.remote.max_concurrent_agents).toBe(5);
    });

    it('rejects an invalid resiliency_tier', async () => {
      const { getDefaultConfigSync, normalizeRemoteConfig } = await import('../../src/lib/config.js');
      const config = getDefaultConfigSync();
      config.remote = { enabled: true, resiliency_tier: 'invalid' as any };
      expect(() => normalizeRemoteConfig(config)).toThrow('Invalid remote.resiliency_tier');
    });
  });

  describe('loadConfigSync remote round-trip', () => {
    it('reads resiliency_tier and max_concurrent_agents from a config file', async () => {
      const configPath = join(tempDir, 'config.toml');
      writeFileSync(
        configPath,
        `[remote]\nenabled = true\nresiliency_tier = "durable"\nmax_concurrent_agents = 7\n`,
      );
      vi.resetModules();
      vi.doMock('../../src/lib/paths.js', () => ({ CONFIG_FILE: configPath }));
      vi.doMock('../../src/lib/config-yaml.js', () => ({
        loadConfig: () => ({ config: {}, migration: null }),
        loadConfigSync: () => ({ config: {}, migration: null }),
      }));
      const { loadConfigSync } = await import('../../src/lib/config.js');
      const config = loadConfigSync();
      expect(config.remote?.enabled).toBe(true);
      expect(config.remote?.resiliency_tier).toBe('durable');
      expect(config.remote?.max_concurrent_agents).toBe(7);
      vi.doUnmock('../../src/lib/paths.js');
      vi.doUnmock('../../src/lib/config-yaml.js');
    });

    it('lets config.yaml remote settings override config.toml values', async () => {
      const configPath = join(tempDir, 'config.toml');
      writeFileSync(
        configPath,
        `[remote]\nenabled = true\nresiliency_tier = "ephemeral"\nmax_concurrent_agents = 3\n`,
      );
      vi.resetModules();
      vi.doMock('../../src/lib/paths.js', () => ({ CONFIG_FILE: configPath }));
      vi.doMock('../../src/lib/config-yaml.js', () => ({
        loadConfigSync: () => ({
          config: {
            remote: { resiliencyTier: 'durable', maxConcurrentAgents: 10 },
          },
          migration: null,
        }),
      }));
      const { loadConfigSync } = await import('../../src/lib/config.js');
      const config = loadConfigSync();
      expect(config.remote?.enabled).toBe(true);
      expect(config.remote?.resiliency_tier).toBe('durable');
      expect(config.remote?.max_concurrent_agents).toBe(10);
      vi.doUnmock('../../src/lib/paths.js');
      vi.doUnmock('../../src/lib/config-yaml.js');
    });
  });
});
