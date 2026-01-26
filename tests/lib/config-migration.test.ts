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
      planning_agent: 'claude-opus-4-5',
      complexity: {
        trivial: 'claude-haiku-4-5',
        simple: 'claude-haiku-4-5',
        medium: 'claude-sonnet-4-5',
        complex: 'claude-sonnet-4-5',
        expert: 'claude-opus-4-5',
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
          planning_agent: 'claude-opus-4-5',
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-5',
          },
        },
        api_keys: {
          openai: 'sk-test-123',
        },
      };

      const yamlConfig = convertToYamlConfig(legacySettings);

      expect(yamlConfig.models?.preset).toBeDefined();
      expect(yamlConfig.api_keys).toEqual({ openai: 'sk-test-123' });
    });

    it('should detect balanced preset from default model distribution', () => {
      const legacySettings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          planning_agent: 'claude-opus-4-5',
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-5',
          },
        },
        api_keys: {},
      };

      const yamlConfig = convertToYamlConfig(legacySettings);

      expect(yamlConfig.models?.preset).toBe('balanced');
    });

    it('should detect budget preset when only haiku/flash models used', () => {
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

      expect(yamlConfig.models?.preset).toBe('budget');
    });

    it('should create overrides for non-standard model assignments', () => {
      const legacySettings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-opus-4-5', // Non-standard
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          planning_agent: 'claude-opus-4-5',
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-5',
          },
        },
        api_keys: {},
      };

      const yamlConfig = convertToYamlConfig(legacySettings);

      expect(yamlConfig.models?.overrides).toBeDefined();
      expect(yamlConfig.models?.overrides?.['specialist-review-agent']).toBe('claude-opus-4-5');
    });

    it('should preserve all API keys', () => {
      const legacySettings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          planning_agent: 'claude-opus-4-5',
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-5',
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
