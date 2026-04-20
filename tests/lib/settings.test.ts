import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('settings', () => {
  let tempDir: string;
  let originalPanopticonHome: string | undefined;

  beforeEach(() => {
    // Create temp directory for isolated tests
    tempDir = mkdtempSync(join(tmpdir(), 'pan-settings-test-'));

    // Override PANOPTICON_HOME for this test
    originalPanopticonHome = process.env.PANOPTICON_HOME;
    process.env.PANOPTICON_HOME = tempDir;

    // Clear module cache to reload with new env var
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env var
    if (originalPanopticonHome) {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    } else {
      delete process.env.PANOPTICON_HOME;
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getDefaultSettings', () => {
    it('should return default Kimi configuration', async () => {
      const { getDefaultSettings } = await import('../../src/lib/settings.js');
      const defaults = getDefaultSettings();

      // Default model configuration per DEFAULT_SETTINGS
      expect(defaults.models.specialists.review_agent).toBe('claude-opus-4-6');
      expect(defaults.models.specialists.test_agent).toBe('claude-sonnet-4-6');
      expect(defaults.models.specialists.merge_agent).toBe('claude-sonnet-4-6');
      expect(defaults.api_keys).toEqual({});
    });

    it('should include all complexity levels', async () => {
      const { getDefaultSettings } = await import('../../src/lib/settings.js');
      const defaults = getDefaultSettings();

      // Complexity levels per DEFAULT_SETTINGS
      expect(defaults.models.complexity.trivial).toBe('claude-haiku-4-5');
      expect(defaults.models.complexity.simple).toBe('claude-haiku-4-5');
      expect(defaults.models.complexity.medium).toBe('kimi-k2.5');
      expect(defaults.models.complexity.complex).toBe('kimi-k2.5');
      expect(defaults.models.complexity.expert).toBe('claude-opus-4-6');
    });

    it('should return a deep copy (not same reference)', async () => {
      const { getDefaultSettings } = await import('../../src/lib/settings.js');
      const defaults1 = getDefaultSettings();
      const defaults2 = getDefaultSettings();

      expect(defaults1).not.toBe(defaults2);
      expect(defaults1.models).not.toBe(defaults2.models);
      expect(defaults1).toEqual(defaults2);
    });
  });

  describe('loadSettings', () => {
    it('should return defaults when file does not exist', async () => {
      const { loadSettings, getDefaultSettings } = await import('../../src/lib/settings.js');

      // Clear any env vars that might affect API keys
      const originalOpenAI = process.env.OPENAI_API_KEY;
      const originalGoogle = process.env.GOOGLE_API_KEY;
      const originalMinimax = process.env.MINIMAX_API_KEY;
      const originalZai = process.env.ZAI_API_KEY;
      const originalKimi = process.env.KIMI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.ZAI_API_KEY;
      delete process.env.KIMI_API_KEY;

      try {
        const loaded = loadSettings();
        const defaults = getDefaultSettings();

        expect(loaded).toEqual(defaults);
      } finally {
        // Restore env vars
        if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
        if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
        if (originalMinimax) process.env.MINIMAX_API_KEY = originalMinimax;
        if (originalZai) process.env.ZAI_API_KEY = originalZai;
        if (originalKimi) process.env.KIMI_API_KEY = originalKimi;
      }
    });

    it('should merge user settings with defaults', async () => {
      const { loadSettings } = await import('../../src/lib/settings.js');

      // Write partial settings (only override test_agent)
      const settingsPath = join(tempDir, 'settings.json');
      const userSettings = {
        models: {
          specialists: {
            test_agent: 'gpt-4o-mini',
          },
        },
        api_keys: {
          openai: 'sk-test-key',
        },
      };
      writeFileSync(settingsPath, JSON.stringify(userSettings), 'utf8');

      const loaded = loadSettings();

      // User values should override defaults
      expect(loaded.models.specialists.test_agent).toBe('gpt-4o-mini');
      expect(loaded.api_keys.openai).toBe('sk-test-key');

      // Other values should be defaults per DEFAULT_SETTINGS
      expect(loaded.models.specialists.review_agent).toBe('claude-opus-4-6');
      expect(loaded.models.complexity.trivial).toBe('claude-haiku-4-5');
    });

    it('should handle invalid JSON gracefully', async () => {
      const { loadSettings, getDefaultSettings } = await import('../../src/lib/settings.js');

      // Clear any env vars that might affect API keys
      const originalOpenAI = process.env.OPENAI_API_KEY;
      const originalGoogle = process.env.GOOGLE_API_KEY;
      const originalMinimax = process.env.MINIMAX_API_KEY;
      const originalZai = process.env.ZAI_API_KEY;
      const originalKimi = process.env.KIMI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.ZAI_API_KEY;
      delete process.env.KIMI_API_KEY;

      try {
        // Write invalid JSON
        const settingsPath = join(tempDir, 'settings.json');
        writeFileSync(settingsPath, '{ invalid json }', 'utf8');

        const loaded = loadSettings();
        const defaults = getDefaultSettings();

        // Should return defaults on parse error
        expect(loaded).toEqual(defaults);
      } finally {
        // Restore env vars
        if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
        if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
        if (originalMinimax) process.env.MINIMAX_API_KEY = originalMinimax;
        if (originalZai) process.env.ZAI_API_KEY = originalZai;
        if (originalKimi) process.env.KIMI_API_KEY = originalKimi;
      }
    });

    it('should handle empty JSON object', async () => {
      const { loadSettings, getDefaultSettings } = await import('../../src/lib/settings.js');

      // Clear any env vars that might affect API keys
      const originalOpenAI = process.env.OPENAI_API_KEY;
      const originalGoogle = process.env.GOOGLE_API_KEY;
      const originalMinimax = process.env.MINIMAX_API_KEY;
      const originalZai = process.env.ZAI_API_KEY;
      const originalKimi = process.env.KIMI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.ZAI_API_KEY;
      delete process.env.KIMI_API_KEY;

      try {
        // Write empty JSON
        const settingsPath = join(tempDir, 'settings.json');
        writeFileSync(settingsPath, '{}', 'utf8');

        const loaded = loadSettings();
        const defaults = getDefaultSettings();

        // Should return defaults when merging with empty object
        expect(loaded).toEqual(defaults);
      } finally {
        // Restore env vars
        if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
        if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
        if (originalMinimax) process.env.MINIMAX_API_KEY = originalMinimax;
        if (originalZai) process.env.ZAI_API_KEY = originalZai;
        if (originalKimi) process.env.KIMI_API_KEY = originalKimi;
      }
    });

    it('should deep merge nested objects', async () => {
      const { loadSettings } = await import('../../src/lib/settings.js');

      // Write nested partial settings
      const settingsPath = join(tempDir, 'settings.json');
      const userSettings = {
        models: {
          complexity: {
            expert: 'gpt-5.2-codex', // Override just one complexity level
          },
        },
      };
      writeFileSync(settingsPath, JSON.stringify(userSettings), 'utf8');

      const loaded = loadSettings();

      // User override should apply
      expect(loaded.models.complexity.expert).toBe('gpt-5.2-codex');

      // Other complexity levels should be defaults per DEFAULT_SETTINGS
      expect(loaded.models.complexity.trivial).toBe('claude-haiku-4-5');
      expect(loaded.models.complexity.simple).toBe('claude-haiku-4-5');
      expect(loaded.models.complexity.medium).toBe('kimi-k2.5');
      expect(loaded.models.complexity.complex).toBe('kimi-k2.5');

      // Other sections should be defaults per DEFAULT_SETTINGS
      expect(loaded.models.specialists.review_agent).toBe('claude-opus-4-6');
    });
  });

  describe('saveSettings', () => {
    it('should write settings to file with pretty formatting', async () => {
      const { saveSettings, loadSettings, getDefaultSettings } = await import('../../src/lib/settings.js');

      // Clear any env vars that might affect API keys
      const originalOpenAI = process.env.OPENAI_API_KEY;
      const originalGoogle = process.env.GOOGLE_API_KEY;
      const originalMinimax = process.env.MINIMAX_API_KEY;
      const originalZai = process.env.ZAI_API_KEY;
      const originalKimi = process.env.KIMI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.ZAI_API_KEY;
      delete process.env.KIMI_API_KEY;

      try {
        const settings = getDefaultSettings();
        settings.api_keys.openai = 'sk-test-key';
        settings.models.specialists.test_agent = 'gpt-4o-mini';

        saveSettings(settings);

        // Verify file was written
        const loaded = loadSettings();
        expect(loaded).toEqual(settings);
      } finally {
        // Restore env vars
        if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
        if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
        if (originalMinimax) process.env.MINIMAX_API_KEY = originalMinimax;
        if (originalZai) process.env.ZAI_API_KEY = originalZai;
        if (originalKimi) process.env.KIMI_API_KEY = originalKimi;
      }
    });

    it('should create valid JSON', async () => {
      const { saveSettings, getDefaultSettings } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettings();
      saveSettings(settings);

      // Read file and verify it's valid JSON
      const settingsPath = join(tempDir, 'settings.json');
      const content = require('fs').readFileSync(settingsPath, 'utf8');

      expect(() => JSON.parse(content)).not.toThrow();
    });
  });

  describe('validateSettings', () => {
    it('should return null for valid settings', async () => {
      const { validateSettings, getDefaultSettings } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettings();
      const error = validateSettings(settings);

      expect(error).toBeNull();
    });

    it('should detect missing models configuration', async () => {
      const { validateSettings } = await import('../../src/lib/settings.js');

      const invalidSettings: any = {
        api_keys: {},
      };

      const error = validateSettings(invalidSettings);
      expect(error).toBe('Missing models configuration');
    });

    it('should detect missing specialists configuration', async () => {
      const { validateSettings } = await import('../../src/lib/settings.js');

      const invalidSettings: any = {
        models: {},
        api_keys: {},
      };

      const error = validateSettings(invalidSettings);
      expect(error).toBe('Missing specialists configuration');
    });

    it('should detect missing specialist agent models', async () => {
      const { validateSettings } = await import('../../src/lib/settings.js');

      const invalidSettings: any = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            // Missing test_agent and merge_agent
          },
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

      const error = validateSettings(invalidSettings);
      expect(error).toBe('Missing specialist agent model configuration');
    });

    it('should detect missing complexity configuration', async () => {
      const { validateSettings } = await import('../../src/lib/settings.js');

      const invalidSettings: any = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          // Missing complexity
        },
        api_keys: {},
      };

      const error = validateSettings(invalidSettings);
      expect(error).toBe('Missing complexity configuration');
    });

    it('should detect missing complexity levels', async () => {
      const { validateSettings } = await import('../../src/lib/settings.js');

      const invalidSettings: any = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            // Missing complex and expert
          },
        },
        api_keys: {},
      };

      const error = validateSettings(invalidSettings);
      expect(error).toContain('Missing complexity level:');
    });

    it('should detect missing api_keys configuration', async () => {
      const { validateSettings } = await import('../../src/lib/settings.js');

      const invalidSettings: any = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-6',
          },
        },
        // Missing api_keys
      };

      const error = validateSettings(invalidSettings);
      expect(error).toBe('Missing api_keys configuration');
    });
  });

  describe('getAvailableModels', () => {
    it('should always return Anthropic models', async () => {
      const { getAvailableModels, getDefaultSettings } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettings();
      const available = getAvailableModels(settings);

      expect(available.anthropic).toEqual([
        'claude-opus-4-6',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
      ]);
    });

    it('should return empty arrays for providers without API keys', async () => {
      const { getAvailableModels, getDefaultSettings } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettings();
      const available = getAvailableModels(settings);

      expect(available.openai).toEqual([]);
      expect(available.google).toEqual([]);
      expect(available.minimax).toEqual([]);
      expect(available.kimi).toEqual([]);
    });

    it('should return OpenAI models when API key is configured', async () => {
      const { getAvailableModels, getDefaultSettings } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettings();
      settings.api_keys.openai = 'sk-test-key';

      const available = getAvailableModels(settings);

      expect(available.openai).toEqual([
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
        'gpt-5.4-pro',
        'o3',
        'o4-mini',
      ]);
    });

    it('should return Google models when API key is configured', async () => {
      const { getAvailableModels, getDefaultSettings } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettings();
      settings.api_keys.google = 'AIza-test-key';

      const available = getAvailableModels(settings);

      expect(available.google).toEqual([
        'gemini-3.1-pro-preview',
        'gemini-3-flash',
        'gemini-3.1-flash-lite-preview',
      ]);
    });

    it('should return MiniMax models when API key is configured', async () => {
      const { getAvailableModels, getDefaultSettings } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettings();
      settings.api_keys.minimax = 'minimax-test-key';

      const available = getAvailableModels(settings);

      expect(available.minimax).toEqual(['minimax-m2.7', 'minimax-m2.7-highspeed']);
    });

    it('should return Kimi models when API key is configured', async () => {
      const { getAvailableModels, getDefaultSettings } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettings();
      settings.api_keys.kimi = 'kimi-test-key';

      const available = getAvailableModels(settings);

      expect(available.kimi).toEqual(['kimi-k2.6', 'kimi-k2.5', 'K2.6-code-preview']);
    });

    it('should return multiple providers when multiple API keys configured', async () => {
      const { getAvailableModels, getDefaultSettings } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettings();
      settings.api_keys.openai = 'sk-test-key';
      settings.api_keys.google = 'AIza-test-key';
      settings.api_keys.minimax = 'minimax-test-key';

      const available = getAvailableModels(settings);

      expect(available.anthropic.length).toBeGreaterThan(0);
      expect(available.openai.length).toBeGreaterThan(0);
      expect(available.google.length).toBeGreaterThan(0);
      expect(available.minimax.length).toBeGreaterThan(0);
    });
  });
});
