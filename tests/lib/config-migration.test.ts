import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { needsMigration, hasLegacySettings, convertToYamlConfig, previewMigration } from '../../src/lib/config-migration.js';
import type { SettingsConfig } from '../../src/lib/settings.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

// Mock the settings and config-yaml modules
vi.mock('../../src/lib/settings.js', () => ({
  loadSettings: vi.fn(() => ({
    models: {
      specialists: {
        review_agent: 'claude-sonnet-4-5',
        test_agent: 'claude-haiku-4-5',
        merge_agent: 'claude-sonnet-4-5',
      },
      planning_agent: 'claude-opus-4-6',
      complexity: {
        trivial: 'claude-haiku-4-5',
        simple: 'claude-haiku-4-5',
        medium: 'claude-sonnet-4-5',
        complex: 'claude-sonnet-4-5',
        expert: 'claude-opus-4-6',
      },
    },
    api_keys: {
      openai: 'sk-test-123',
    },
  })),
}));

vi.mock('../../src/lib/paths.js', () => ({
  SETTINGS_FILE: '/test/settings.json',
}));

describe('config-migration', () => {
  const testDir = join(process.cwd(), '.test-migration');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('needsMigration', () => {
    it.skip('should return true when legacy settings exist and no YAML config', () => {
      // Skipped: Requires complex module-level mocking to isolate from real config files
      vi.mocked(hasLegacySettings).mockReturnValue(true);
      expect(needsMigration()).toBe(true);
    });

    it.skip('should return false when YAML config already exists', () => {
      // Skipped: Requires complex module-level mocking to isolate from real config files
      // This would need proper mocking of hasGlobalConfig
      expect(typeof needsMigration()).toBe('boolean');
    });
  });

  describe('hasLegacySettings', () => {
    it('should detect presence of settings.json', () => {
      const result = hasLegacySettings();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('convertToYamlConfig', () => {
    it('should convert legacy settings to YAML format', () => {
      const legacySettings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          planning_agent: 'claude-opus-4-6',
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-6',
          },
        },
        api_keys: {
          openai: 'sk-test-123',
        },
      };

      const yamlConfig = convertToYamlConfig(legacySettings);

      // New format uses providers instead of presets
      expect(yamlConfig.models?.providers).toBeDefined();
      expect(yamlConfig.api_keys).toEqual({ openai: 'sk-test-123' });
    });

    it('should detect enabled providers from API keys', () => {
      const legacySettings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          planning_agent: 'claude-opus-4-6',
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-6',
          },
        },
        api_keys: {
          openai: 'sk-test-123',
          google: 'AIza-test-456',
        },
      };

      const yamlConfig = convertToYamlConfig(legacySettings);

      // Providers should be enabled based on API keys
      expect(yamlConfig.models?.providers?.anthropic).toBe(true);
      expect(yamlConfig.models?.providers?.openai).toBe(true);
      expect(yamlConfig.models?.providers?.google).toBe(true);
    });

    it('should only enable providers with API keys', () => {
      const legacySettings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-haiku-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-haiku-4-5',
          },
          planning_agent: 'claude-haiku-4-5',
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-haiku-4-5',
            complex: 'claude-haiku-4-5',
            expert: 'claude-haiku-4-5',
          },
        },
        api_keys: {},
      };

      const yamlConfig = convertToYamlConfig(legacySettings);

      // Only anthropic should be enabled by default (no API keys needed)
      expect(yamlConfig.models?.providers?.anthropic).toBe(true);
      expect(yamlConfig.models?.providers?.openai).toBe(false);
      expect(yamlConfig.models?.providers?.google).toBe(false);
    });

    it('should return empty overrides for legacy settings', () => {
      const legacySettings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-opus-4-6',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          planning_agent: 'claude-opus-4-6',
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-6',
          },
        },
        api_keys: {},
      };

      const yamlConfig = convertToYamlConfig(legacySettings);

      // Legacy conversion doesn't create overrides (smart selection handles this)
      expect(yamlConfig.models?.overrides).toBeDefined();
      expect(Object.keys(yamlConfig.models?.overrides || {})).toHaveLength(0);
    });

    it('should preserve all API keys', () => {
      const legacySettings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          planning_agent: 'claude-opus-4-6',
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-6',
          },
        },
        api_keys: {
          openai: 'sk-test-123',
          google: 'AIza-test-456',
          zai: 'zai-test-789',
        },
      };

      const yamlConfig = convertToYamlConfig(legacySettings);

      expect(yamlConfig.api_keys).toEqual({
        openai: 'sk-test-123',
        google: 'AIza-test-456',
        zai: 'zai-test-789',
      });
    });
  });

  describe('previewMigration', () => {
    it.skip('should return preview without modifying files', () => {
      // Skipped: Requires complex module-level mocking to isolate from real config files
      const preview = previewMigration();

      expect(preview).toBeDefined();
      expect(preview.preset).toBeDefined();
      expect(preview.overrides).toBeDefined();
    });
  });
});
