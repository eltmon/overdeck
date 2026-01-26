import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadSettingsApi, saveSettingsApi, validateSettingsApi, getAvailableModelsApi } from '../../src/lib/settings-api.js';
import type { ApiSettingsConfig } from '../../src/lib/settings-api.js';

// Mock the config-yaml module
vi.mock('../../src/lib/config-yaml.js', () => ({
  loadConfig: vi.fn(() => ({
    preset: 'balanced',
    enabledProviders: new Set(['anthropic', 'openai']),
    apiKeys: {
      openai: 'sk-test-123',
    },
    overrides: {},
    geminiThinkingLevel: 3,
  })),
  getGlobalConfigPath: vi.fn(() => '/test/config.yaml'),
}));

// Mock fs module to prevent actual file writes
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
  };
});

describe('settings-api', () => {
  describe('loadSettingsApi', () => {
    it('should convert NormalizedConfig to ApiSettingsConfig format', () => {
      const settings = loadSettingsApi();

      expect(settings.models.preset).toBe('balanced');
      expect(settings.models.providers.anthropic).toBe(true);
      expect(settings.models.providers.openai).toBe(true);
      expect(settings.models.providers.google).toBe(false);
      expect(settings.models.providers.zai).toBe(false);
      expect(settings.api_keys.openai).toBe('sk-test-123');
      expect(settings.models.gemini_thinking_level).toBe(3);
    });

    it('should always enable anthropic provider', () => {
      const settings = loadSettingsApi();
      expect(settings.models.providers.anthropic).toBe(true);
    });
  });

  describe('validateSettingsApi', () => {
    const validSettings: ApiSettingsConfig = {
      models: {
        preset: 'balanced',
        providers: {
          anthropic: true,
          openai: true,
          google: false,
          zai: false,
        },
        overrides: {},
        gemini_thinking_level: 3,
      },
      api_keys: {
        openai: 'sk-test-123',
      },
    };

    it('should return null for valid settings', () => {
      const error = validateSettingsApi(validSettings);
      expect(error).toBeNull();
    });

    it('should reject missing models configuration', () => {
      const invalid = { ...validSettings, models: undefined } as any;
      const error = validateSettingsApi(invalid);

      expect(error).toBe('Missing models configuration');
    });

    it('should reject invalid preset', () => {
      const invalid = {
        ...validSettings,
        models: {
          ...validSettings.models,
          preset: 'invalid' as any,
        },
      };
      const error = validateSettingsApi(invalid);

      expect(error).toContain('Invalid preset');
    });

    it('should reject missing providers configuration', () => {
      const invalid = {
        ...validSettings,
        models: {
          ...validSettings.models,
          providers: undefined as any,
        },
      };
      const error = validateSettingsApi(invalid);

      expect(error).toBe('Missing providers configuration');
    });

    it('should reject disabled anthropic provider', () => {
      const invalid = {
        ...validSettings,
        models: {
          ...validSettings.models,
          providers: {
            ...validSettings.models.providers,
            anthropic: false,
          },
        },
      };
      const error = validateSettingsApi(invalid);

      expect(error).toBe('Anthropic provider must be enabled (required)');
    });

    it('should reject invalid gemini thinking level', () => {
      const invalid = {
        ...validSettings,
        models: {
          ...validSettings.models,
          gemini_thinking_level: 5,
        },
      };
      const error = validateSettingsApi(invalid);

      expect(error).toContain('Gemini thinking level must be an integer between 1 and 4');
    });

    it('should accept valid gemini thinking levels (1-4)', () => {
      for (let level = 1; level <= 4; level++) {
        const settings = {
          ...validSettings,
          models: {
            ...validSettings.models,
            gemini_thinking_level: level,
          },
        };
        const error = validateSettingsApi(settings);
        expect(error).toBeNull();
      }
    });
  });

  describe('getAvailableModelsApi', () => {
    it('should return only enabled provider models', () => {
      const settings: ApiSettingsConfig = {
        models: {
          preset: 'balanced',
          providers: {
            anthropic: true,
            openai: true,
            google: false,
            zai: false,
          },
          overrides: {},
        },
        api_keys: {},
      };

      const models = getAvailableModelsApi(settings);

      expect(models.anthropic).toBeDefined();
      expect(models.openai).toBeDefined();
      expect(models.google).toBeUndefined();
      expect(models.zai).toBeUndefined();
    });

    it('should include all anthropic models when enabled', () => {
      const settings: ApiSettingsConfig = {
        models: {
          preset: 'balanced',
          providers: {
            anthropic: true,
            openai: false,
            google: false,
            zai: false,
          },
          overrides: {},
        },
        api_keys: {},
      };

      const models = getAvailableModelsApi(settings);

      expect(models.anthropic).toContain('claude-opus-4-5');
      expect(models.anthropic).toContain('claude-sonnet-4-5');
      expect(models.anthropic).toContain('claude-haiku-4-5');
    });

    it('should include openai models when enabled', () => {
      const settings: ApiSettingsConfig = {
        models: {
          preset: 'balanced',
          providers: {
            anthropic: true,
            openai: true,
            google: false,
            zai: false,
          },
          overrides: {},
        },
        api_keys: {},
      };

      const models = getAvailableModelsApi(settings);

      expect(models.openai).toContain('gpt-5.2-codex');
      expect(models.openai).toContain('gpt-4o');
    });
  });

  describe('saveSettingsApi', () => {
    it('should convert ApiSettingsConfig to YAML format', async () => {
      const { writeFileSync } = await import('fs');
      const settings: ApiSettingsConfig = {
        models: {
          preset: 'premium',
          providers: {
            anthropic: true,
            openai: true,
            google: false,
            zai: false,
          },
          overrides: {
            'issue-agent:planning': 'claude-opus-4-5',
          },
          gemini_thinking_level: 4,
        },
        api_keys: {
          openai: 'sk-test-123',
        },
      };

      // Should not throw
      expect(() => saveSettingsApi(settings)).not.toThrow();

      // Verify writeFileSync was called
      expect(writeFileSync).toHaveBeenCalled();

      // Verify the YAML content contains expected fields
      const callArgs = vi.mocked(writeFileSync).mock.calls[0];
      const yamlContent = callArgs[1] as string;
      expect(yamlContent).toContain('preset: premium');
      expect(yamlContent).toContain('anthropic: true');
      expect(yamlContent).toContain('openai: true');
      expect(yamlContent).toContain('issue-agent:planning: claude-opus-4-5');
      expect(yamlContent).toContain('openai: sk-test-123');
      expect(yamlContent).toContain('gemini_thinking_level: 4');
    });
  });
});
