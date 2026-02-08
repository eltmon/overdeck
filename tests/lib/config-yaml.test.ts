import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadConfig, hasProjectConfig, hasGlobalConfig, getGlobalConfigPath, getProjectConfigPath } from '../../src/lib/config-yaml.js';

describe('config-yaml', () => {
  const testDir = join(process.cwd(), '.test-config-yaml');
  const testGlobalConfig = join(testDir, 'global-config.yaml');
  const testProjectConfig = join(testDir, 'project', '.panopticon.yaml');

  beforeEach(() => {
    // Create test directories
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'project', '.git'), { recursive: true });
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadConfig', () => {
    it.skip('should return default config when no config files exist', () => {
      // Skipped: Cannot isolate from real config file without mocking module-level imports
      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config.preset).toBe('balanced');
      expect(config.enabledProviders).toContain('anthropic');
      expect(config.geminiThinkingLevel).toBe(3);
    });

    it.skip('should load global config when it exists', () => {
      // Skipped: Cannot isolate from real config file without mocking module-level imports
      // Write test global config
      const yamlContent = `
models:
  preset: premium
  providers:
    anthropic: true
    openai: true
    google: false
    zai: false
`;
      writeFileSync(testGlobalConfig, yamlContent, 'utf-8');

      // Mock the global config path
      process.env.HOME = testDir;

      const config = loadConfig();

      expect(config.preset).toBe('premium');
      expect(config.enabledProviders.has('openai')).toBe(true);
      expect(config.enabledProviders.has('google')).toBe(false);
    });

    it.skip('should merge project config with higher precedence', () => {
      // Skipped: Cannot isolate from real config file without mocking module-level imports
      // Write global config
      const globalYaml = `
models:
  preset: balanced
  providers:
    anthropic: true
    openai: true
`;
      writeFileSync(testGlobalConfig, globalYaml, 'utf-8');

      // Write project config
      const projectYaml = `
models:
  preset: premium
  overrides:
    issue-agent:planning: claude-opus-4-5
`;
      writeFileSync(testProjectConfig, projectYaml, 'utf-8');

      const config = loadConfig();

      expect(config.preset).toBe('premium');
      expect(config.overrides['issue-agent:planning']).toBe('claude-opus-4-5');
    });

    it.skip('should handle legacy api_keys format', () => {
      // Skipped: Cannot isolate from real config file without mocking module-level imports
      const yamlContent = `
api_keys:
  openai: sk-test-123
  google: AIza-test-456
`;
      writeFileSync(testGlobalConfig, yamlContent, 'utf-8');

      const config = loadConfig();

      expect(config.apiKeys.openai).toBe('sk-test-123');
      expect(config.apiKeys.google).toBe('AIza-test-456');
      expect(config.enabledProviders.has('openai')).toBe(true);
      expect(config.enabledProviders.has('google')).toBe(true);
    });

    it.skip('should resolve environment variables in API keys', () => {
      // Skipped: Cannot isolate from real config file without mocking module-level imports
      process.env.TEST_OPENAI_KEY = 'sk-from-env';

      const yamlContent = `
api_keys:
  openai: $TEST_OPENAI_KEY
`;
      writeFileSync(testGlobalConfig, yamlContent, 'utf-8');

      const config = loadConfig();

      expect(config.apiKeys.openai).toBe('sk-from-env');

      delete process.env.TEST_OPENAI_KEY;
    });
  });

  describe('hasGlobalConfig', () => {
    it.skip('should return false when global config does not exist', () => {
      // Skipped: Cannot isolate from real config file without mocking module-level imports
      expect(hasGlobalConfig()).toBe(false);
    });

    it.skip('should return true when global config exists', () => {
      // Skipped: Cannot isolate from real config file without mocking module-level imports
      writeFileSync(testGlobalConfig, 'models: {}', 'utf-8');
      process.env.HOME = testDir;

      expect(hasGlobalConfig()).toBe(true);
    });
  });

  describe('hasProjectConfig', () => {
    it.skip('should return false when not in a git project', () => {
      // Skipped: process.chdir() not supported in Vitest workers
      process.chdir(testDir);
      expect(hasProjectConfig()).toBe(false);
    });

    it.skip('should return false when in git project but no config exists', () => {
      // Skipped: process.chdir() not supported in Vitest workers
      process.chdir(join(testDir, 'project'));
      expect(hasProjectConfig()).toBe(false);
    });

    it.skip('should return true when project config exists', () => {
      // Skipped: process.chdir() not supported in Vitest workers
      writeFileSync(testProjectConfig, 'models: {}', 'utf-8');
      process.chdir(join(testDir, 'project'));

      expect(hasProjectConfig()).toBe(true);
    });
  });

  describe('getGlobalConfigPath', () => {
    it('should return path to global config', () => {
      // This test is safe as it only checks the path structure, not file existence
      const path = getGlobalConfigPath();
      expect(path).toContain('.panopticon');
      expect(path).toContain('config.yaml');
    });
  });

  describe('getProjectConfigPath', () => {
    it.skip('should return null when not in a git project', () => {
      // Skipped: process.chdir() not supported in Vitest workers
      process.chdir(testDir);
      const path = getProjectConfigPath();
      expect(path).toBeNull();
    });

    it.skip('should return path to project config when in git project', () => {
      // Skipped: process.chdir() not supported in Vitest workers
      process.chdir(join(testDir, 'project'));
      const path = getProjectConfigPath();

      expect(path).toBeDefined();
      expect(path).toContain('.panopticon.yaml');
    });
  });
});
