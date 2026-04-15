import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig } from '../../src/lib/config-yaml.js';
import { loadSettingsApi, saveSettingsApi, validateSettingsApi, getAvailableModelsApi, getMiniMaxDefaultsApi } from '../../src/lib/settings-api.js';
import type { ApiSettingsConfig } from '../../src/lib/settings-api.js';

// Mock the config-yaml module
vi.mock('../../src/lib/config-yaml.js', () => ({
  loadConfig: vi.fn(() => ({
    config: {
      preset: 'balanced',
      enabledProviders: new Set(['anthropic', 'openai']),
      apiKeys: {
        openai: 'sk-test-123',
      },
      overrides: {},
      geminiThinkingLevel: 3,
      tmux: {
        configMode: 'managed',
      },
      trackerKeys: {},
    },
    migration: null,
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

// Mock fs/promises module for async file operations
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    writeFile: vi.fn(),
  };
});

describe('settings-api', () => {
  describe('loadSettingsApi', () => {
    it.skip('should convert NormalizedConfig to ApiSettingsConfig format', () => {
      const settings = loadSettingsApi();

      // Note: preset was removed - we now use smart capability-based selection
      expect(settings.models.providers.anthropic).toBe(true);
      expect(settings.models.providers.openai).toBe(true);
      expect(settings.models.providers.google).toBe(false);
      expect(settings.models.providers.minimax).toBe(false);
      expect(settings.models.providers.zai).toBe(false);
      expect(settings.models.providers.kimi).toBe(false);
      expect(settings.models.gemini_thinking_level).toBe(3);
    });

    it.skip('should always enable anthropic provider', () => {
      const settings = loadSettingsApi();
      expect(settings.models.providers.anthropic).toBe(true);
    });

    it('should migrate convoy:* override keys to review:* equivalents', () => {
      // Simulate a persisted config written before PAN-540 removed the convoy abstraction
      vi.mocked(loadConfig).mockReturnValueOnce({
        config: {
          preset: 'balanced',
          enabledProviders: new Set(['anthropic']),
          apiKeys: {},
          overrides: {
            'convoy:security-reviewer': 'claude-opus-4-6',
            'convoy:performance-reviewer': 'claude-sonnet-4-6',
            'convoy:correctness-reviewer': 'claude-sonnet-4-6',
            'convoy:requirements-reviewer': 'claude-sonnet-4-6',
            'convoy:synthesis-agent': 'claude-sonnet-4-6',
            // Non-convoy key should pass through unchanged
            'specialist-review-agent': 'claude-haiku-4-5',
          },
          geminiThinkingLevel: 3,
          tmux: { configMode: 'managed' },
          trackerKeys: {},
        },
        migration: null,
      } as any);

      const settings = loadSettingsApi();

      // convoy:* keys should be remapped to their review:* equivalents
      expect(settings.models.overrides['review:security']).toBe('claude-opus-4-6');
      expect(settings.models.overrides['review:performance']).toBe('claude-sonnet-4-6');
      expect(settings.models.overrides['review:correctness']).toBe('claude-sonnet-4-6');
      expect(settings.models.overrides['review:requirements']).toBe('claude-sonnet-4-6');
      expect(settings.models.overrides['review:synthesis']).toBe('claude-sonnet-4-6');

      // Non-convoy key should pass through unchanged
      expect(settings.models.overrides['specialist-review-agent']).toBe('claude-haiku-4-5');

      // convoy:* keys must not appear in the output
      expect(settings.models.overrides['convoy:security-reviewer']).toBeUndefined();
      expect(settings.models.overrides['convoy:performance-reviewer']).toBeUndefined();
      expect(settings.models.overrides['convoy:correctness-reviewer']).toBeUndefined();
      expect(settings.models.overrides['convoy:requirements-reviewer']).toBeUndefined();
      expect(settings.models.overrides['convoy:synthesis-agent']).toBeUndefined();
    });
  });

  describe('validateSettingsApi', () => {
    const validSettings: ApiSettingsConfig = {
      models: {
        providers: {
          anthropic: true,
          openai: true,
          google: false,
          minimax: false,
          zai: false,
          kimi: false,
          openrouter: false,
        },
        overrides: {},
        gemini_thinking_level: 3,
      },
      api_keys: {
        openai: 'sk-test-123',
      },
    };

    it('should return valid for valid settings', () => {
      const result = validateSettingsApi(validSettings);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing models configuration', () => {
      const invalid = { ...validSettings, models: undefined } as any;
      const result = validateSettingsApi(invalid);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing providers configuration');
    });

    it('should reject missing providers configuration', () => {
      const invalid = {
        ...validSettings,
        models: {
          ...validSettings.models,
          providers: undefined as any,
        },
      };
      const result = validateSettingsApi(invalid);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing providers configuration');
    });

    it('should reject invalid gemini thinking level', () => {
      const invalid = {
        ...validSettings,
        models: {
          ...validSettings.models,
          gemini_thinking_level: 5,
        },
      };
      const result = validateSettingsApi(invalid);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Gemini thinking level must be between 1 and 4');
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
        const result = validateSettingsApi(settings);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('getAvailableModelsApi', () => {
    it('should return all providers with model objects', () => {
      const models = getAvailableModelsApi();

      // All providers should be defined as arrays
      expect(models.anthropic).toBeDefined();
      expect(models.openai).toBeDefined();
      expect(models.google).toBeDefined();
      expect(models.minimax).toBeDefined();
      expect(models.zai).toBeDefined();
      expect(models.kimi).toBeDefined();

      // Each model should have id and name properties
      if (models.anthropic.length > 0) {
        expect(models.anthropic[0]).toHaveProperty('id');
        expect(models.anthropic[0]).toHaveProperty('name');
      }
    });

    it('should include all anthropic models', () => {
      const models = getAvailableModelsApi();

      const anthropicIds = models.anthropic.map(m => m.id);
      expect(anthropicIds).toContain('claude-opus-4-6');
      expect(anthropicIds).toContain('claude-sonnet-4-5');
      expect(anthropicIds).toContain('claude-haiku-4-5');
    });

    it('should include openai models as objects', () => {
      const models = getAvailableModelsApi();

      const openaiIds = models.openai.map(m => m.id);
      expect(openaiIds).toContain('gpt-5.4');
      expect(openaiIds).toContain('o3');
      expect(openaiIds).toContain('o4-mini');
    });
  });

  describe('getMiniMaxDefaultsApi', () => {
    it('should return ApiSettingsConfig with minimax as the only enabled provider', () => {
      const settings = getMiniMaxDefaultsApi();

      expect(settings.models.providers.minimax).toBe(true);
      expect(settings.models.providers.anthropic).toBe(false);
      expect(settings.models.providers.openai).toBe(false);
      expect(settings.models.providers.google).toBe(false);
      expect(settings.models.providers.zai).toBe(false);
      expect(settings.models.providers.kimi).toBe(false);
    });

    it('should set all overrides to minimax-m2.7-highspeed', () => {
      const settings = getMiniMaxDefaultsApi();
      const overrides = settings.models.overrides as Record<string, string>;

      expect(Object.keys(overrides).length).toBeGreaterThan(0);
      for (const [workType, modelId] of Object.entries(overrides)) {
        expect(modelId).toBe('minimax-m2.7-highspeed', `Expected ${workType} to use minimax-m2.7-highspeed`);
      }
    });

    it('should return a valid ApiSettingsConfig shape', () => {
      const settings = getMiniMaxDefaultsApi();

      expect(settings).toHaveProperty('models');
      expect(settings).toHaveProperty('models.providers');
      expect(settings).toHaveProperty('models.overrides');
      expect(settings).toHaveProperty('api_keys');
      expect(settings).toHaveProperty('tracker_keys');
    });
  });

  describe('saveSettingsApi', () => {
    it('should convert ApiSettingsConfig to YAML format', async () => {
      const { writeFile } = await import('fs/promises');
      const settings: ApiSettingsConfig = {
        models: {
          providers: {
            anthropic: true,
            openai: true,
            google: false,
            minimax: true,
            zai: true,
            kimi: false,
            openrouter: false,
          },
          overrides: {},
          gemini_thinking_level: 4,
        },
        api_keys: {
          openai: 'sk-test-123',
          minimax: 'minimax-test-123',
          zai: 'zai-test-123',
        },
      };

      // Should not throw
      await saveSettingsApi(settings);

      // Verify writeFile was called
      expect(writeFile).toHaveBeenCalled();

      // Verify the YAML content contains expected fields
      const { writeFile: mockedWriteFile } = await import('fs/promises');
      const callArgs = vi.mocked(mockedWriteFile).mock.calls[0];
      const yamlContent = callArgs[1] as string;
      // Note: preset was removed from the API
            expect(yamlContent).toContain('anthropic: true');
      expect(yamlContent).toContain('openai: true');
      expect(yamlContent).toContain('minimax: true');
      expect(yamlContent).toContain('zai: true');
      expect(yamlContent).toContain('openai: sk-test-123');
      expect(yamlContent).toContain('minimax: minimax-test-123');
      expect(yamlContent).toContain('zai: zai-test-123');
      expect(yamlContent).toContain('gemini_thinking_level: 4');
    });
  });
});
