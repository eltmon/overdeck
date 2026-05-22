import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { TEMP_DIR } from '../../setup.js';

// Mock paths module to use temp directory
vi.mock('../../../src/lib/paths.js', () => ({
  CONFIG_FILE: join(TEMP_DIR, 'config.toml'),
  PANOPTICON_HOME: TEMP_DIR,
}));

// Import after mocking
import { loadConfigSync, saveConfigSync, getDefaultConfigSync } from '../../../src/lib/config.js';

// TODO(PAN-49): Test pollution with TEMP_DIR when run with full suite - passes in isolation
describe.skip('config', () => {
  const testConfigDir = TEMP_DIR;

  beforeEach(() => {
    // Create test directory (global setup cleans up before each test)
    mkdirSync(testConfigDir, { recursive: true });
  });

  // Cleanup handled by global setup

  describe('getDefaultConfig', () => {
    it('should return default config structure', () => {
      const config = getDefaultConfigSync();

      expect(config).toHaveProperty('panopticon');
      expect(config).toHaveProperty('sync');
      expect(config).toHaveProperty('trackers');
      expect(config).toHaveProperty('dashboard');
    });

    it('should have correct default values', () => {
      const config = getDefaultConfigSync();

      expect(config.sync.backup_before_sync).toBe(true);
      expect(config.trackers.primary).toBe('linear');
      expect(config.dashboard.port).toBe(3001);
      expect(config.dashboard.api_port).toBe(3002);
    });

    it('should return a copy, not the original', () => {
      const config1 = getDefaultConfigSync();
      const config2 = getDefaultConfigSync();

      config1.dashboard.port = 9999;

      expect(config2.dashboard.port).toBe(3001);
    });
  });

  describe('loadConfig', () => {
    it('should return default config when file does not exist', () => {
      const config = loadConfigSync();

      expect(config).toEqual(getDefaultConfigSync());
    });

    it('should parse TOML config file', () => {
      const configContent = `
[panopticon]
version = "2.0.0"

[sync]
backup_before_sync = false

[trackers]
primary = "github"

[dashboard]
port = 4000
api_port = 4001
`;
      writeFileSync(join(testConfigDir, 'config.toml'), configContent);

      const config = loadConfigSync();

      expect(config.panopticon.version).toBe('2.0.0');
      expect(config.sync.backup_before_sync).toBe(false);
      expect(config.trackers.primary).toBe('github');
      expect(config.dashboard.port).toBe(4000);
    });

    it('should merge with defaults for missing fields', () => {
      const configContent = `
[dashboard]
port = 5000
`;
      writeFileSync(join(testConfigDir, 'config.toml'), configContent);

      const config = loadConfigSync();

      expect(config.dashboard.port).toBe(5000);
      // Default values should still be present
      expect(config.sync.backup_before_sync).toBe(true);
    });

    it('should return defaults on invalid TOML', () => {
      writeFileSync(join(testConfigDir, 'config.toml'), 'invalid {{{{ toml');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const config = loadConfigSync();

      expect(config).toEqual(getDefaultConfigSync());
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('saveConfig', () => {
    it('should save config as TOML', () => {
      const config = getDefaultConfigSync();
      config.dashboard.port = 9000;

      saveConfigSync(config);

      const content = readFileSync(join(testConfigDir, 'config.toml'), 'utf8');
      expect(content).toContain('port = 9_000'); // TOML formats numbers with underscores
    });

    it('should preserve all config sections', () => {
      const config = getDefaultConfigSync();
      config.trackers.github = {
        type: 'github',
        owner: 'test',
        repo: 'repo',
      };

      saveConfigSync(config);

      const content = readFileSync(join(testConfigDir, 'config.toml'), 'utf8');
      expect(content).toContain('[trackers.github]');
      expect(content).toContain('owner = "test"');
    });
  });
});
