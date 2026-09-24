import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('settings', () => {
  let tempDir: string;
  let originalOverdeckHome: string | undefined;

  beforeEach(() => {
    // Create temp directory for isolated tests
    tempDir = mkdtempSync(join(tmpdir(), 'pan-settings-test-'));

    // Override OVERDECK_HOME for this test
    originalOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = tempDir;

    // Clear module cache to reload with new env var
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env var
    if (originalOverdeckHome) {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    } else {
      delete process.env.OVERDECK_HOME;
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getDefaultSettings', () => {
    it('should return default Kimi configuration', async () => {
      const { getDefaultSettingsSync } = await import('../../src/lib/settings.js');
      const defaults = getDefaultSettingsSync();

      // Default model configuration per DEFAULT_SETTINGS
      expect(defaults.models.specialists.review_agent).toBe('claude-opus-4-6');
      expect(defaults.models.specialists.test_agent).toBe('claude-sonnet-5');
      expect(defaults.models.specialists.merge_agent).toBe('claude-sonnet-5');
      expect(defaults.api_keys).toEqual({});
    });

    it('should return a deep copy (not same reference)', async () => {
      const { getDefaultSettingsSync } = await import('../../src/lib/settings.js');
      const defaults1 = getDefaultSettingsSync();
      const defaults2 = getDefaultSettingsSync();

      expect(defaults1).not.toBe(defaults2);
      expect(defaults1.models).not.toBe(defaults2.models);
      expect(defaults1).toEqual(defaults2);
    });
  });

  describe('loadSettings', () => {
    it('should return defaults when file does not exist', async () => {
      const { loadSettingsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      // Clear any env vars that might affect API keys
      const originalOpenAI = process.env.OPENAI_API_KEY;
      const originalGoogle = process.env.GOOGLE_API_KEY;
      const originalMinimax = process.env.MINIMAX_API_KEY;
      const originalZai = process.env.ZAI_API_KEY;
      const originalKimi = process.env.KIMI_API_KEY;
      const originalKimiCoding = process.env.KIMI_CODING_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.ZAI_API_KEY;
      delete process.env.KIMI_API_KEY;
      delete process.env.KIMI_CODING_API_KEY;

      try {
        const loaded = loadSettingsSync();
        const defaults = getDefaultSettingsSync();

        expect(loaded).toEqual(defaults);
      } finally {
        // Restore env vars
        if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
        if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
        if (originalMinimax) process.env.MINIMAX_API_KEY = originalMinimax;
        if (originalZai) process.env.ZAI_API_KEY = originalZai;
        if (originalKimi) process.env.KIMI_API_KEY = originalKimi;
        if (originalKimiCoding) process.env.KIMI_CODING_API_KEY = originalKimiCoding;
      }
    });

    it('should merge user settings with defaults', async () => {
      const { loadSettingsSync } = await import('../../src/lib/settings.js');

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

      const loaded = loadSettingsSync();

      // User values should override defaults
      expect(loaded.models.specialists.test_agent).toBe('gpt-4o-mini');
      expect(loaded.api_keys.openai).toBe('sk-test-key');

      // Other values should be defaults per DEFAULT_SETTINGS
      expect(loaded.models.specialists.review_agent).toBe('claude-opus-4-6');
    });

    it('should handle invalid JSON gracefully', async () => {
      const { loadSettingsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      // Clear any env vars that might affect API keys
      const originalOpenAI = process.env.OPENAI_API_KEY;
      const originalGoogle = process.env.GOOGLE_API_KEY;
      const originalMinimax = process.env.MINIMAX_API_KEY;
      const originalZai = process.env.ZAI_API_KEY;
      const originalKimi = process.env.KIMI_API_KEY;
      const originalKimiCoding = process.env.KIMI_CODING_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.ZAI_API_KEY;
      delete process.env.KIMI_API_KEY;
      delete process.env.KIMI_CODING_API_KEY;

      try {
        // Write invalid JSON
        const settingsPath = join(tempDir, 'settings.json');
        writeFileSync(settingsPath, '{ invalid json }', 'utf8');

        const loaded = loadSettingsSync();
        const defaults = getDefaultSettingsSync();

        // Should return defaults on parse error
        expect(loaded).toEqual(defaults);
      } finally {
        // Restore env vars
        if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
        if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
        if (originalMinimax) process.env.MINIMAX_API_KEY = originalMinimax;
        if (originalZai) process.env.ZAI_API_KEY = originalZai;
        if (originalKimi) process.env.KIMI_API_KEY = originalKimi;
        if (originalKimiCoding) process.env.KIMI_CODING_API_KEY = originalKimiCoding;
      }
    });

    it('should handle empty JSON object', async () => {
      const { loadSettingsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      // Clear any env vars that might affect API keys
      const originalOpenAI = process.env.OPENAI_API_KEY;
      const originalGoogle = process.env.GOOGLE_API_KEY;
      const originalMinimax = process.env.MINIMAX_API_KEY;
      const originalZai = process.env.ZAI_API_KEY;
      const originalKimi = process.env.KIMI_API_KEY;
      const originalKimiCoding = process.env.KIMI_CODING_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.ZAI_API_KEY;
      delete process.env.KIMI_API_KEY;
      delete process.env.KIMI_CODING_API_KEY;

      try {
        // Write empty JSON
        const settingsPath = join(tempDir, 'settings.json');
        writeFileSync(settingsPath, '{}', 'utf8');

        const loaded = loadSettingsSync();
        const defaults = getDefaultSettingsSync();

        // Should return defaults when merging with empty object
        expect(loaded).toEqual(defaults);
      } finally {
        // Restore env vars
        if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
        if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
        if (originalMinimax) process.env.MINIMAX_API_KEY = originalMinimax;
        if (originalZai) process.env.ZAI_API_KEY = originalZai;
        if (originalKimi) process.env.KIMI_API_KEY = originalKimi;
        if (originalKimiCoding) process.env.KIMI_CODING_API_KEY = originalKimiCoding;
      }
    });

    it('should deep merge nested objects', async () => {
      const { loadSettingsSync } = await import('../../src/lib/settings.js');

      // Write nested partial settings
      const settingsPath = join(tempDir, 'settings.json');
      const userSettings = {
        models: {
          specialists: {
            review_agent: 'gpt-5.3-codex', // Override just one specialist
          },
        },
      };
      writeFileSync(settingsPath, JSON.stringify(userSettings), 'utf8');

      const loaded = loadSettingsSync();

      // User override should apply
      expect(loaded.models.specialists.review_agent).toBe('gpt-5.3-codex');

      // Other specialists should be defaults per DEFAULT_SETTINGS
      expect(loaded.models.specialists.test_agent).toBe('claude-sonnet-5');
      expect(loaded.models.specialists.merge_agent).toBe('claude-sonnet-5');

      // Other sections should be defaults per DEFAULT_SETTINGS
      expect(loaded.models.status_review).toBe('claude-opus-4-6');
    });
  });



  describe('getAvailableModels', () => {
    it('should always return Anthropic models', async () => {
      const { getAvailableModelsSync, getClaudeModelFlagSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettingsSync();
      const available = getAvailableModelsSync(settings);

      expect(available.anthropic).toEqual([
        'claude-fable-5-1',
        'claude-fable-5',
        'claude-opus-5-5',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-sonnet-5',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
      ]);
      expect(getClaudeModelFlagSync('claude-opus-5-5')).toBe('claude-opus-5-5');
    });

    it('should return empty arrays for providers without API keys', async () => {
      const { getAvailableModelsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettingsSync();
      const available = getAvailableModelsSync(settings);

      expect(available.openai).toEqual([]);
      expect(available.google).toEqual([]);
      expect(available.minimax).toEqual([]);
      expect(available.kimi).toEqual([]);
    });

    it('should return OpenAI models when API key is configured', async () => {
      const { getAvailableModelsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettingsSync();
      settings.api_keys.openai = 'sk-test-key';

      const available = getAvailableModelsSync(settings);

      expect(available.openai).toEqual([
        'gpt-6-astra',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
        'gpt-5.6-sol[372k]',
        'gpt-5.6-terra[372k]',
        'gpt-5.6-luna[372k]',
      ]);
    });

    it('should return Google models when API key is configured', async () => {
      const { getAvailableModelsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettingsSync();
      settings.api_keys.google = 'AIza-test-key';

      const available = getAvailableModelsSync(settings);

      expect(available.google).toEqual([
        'gemini-3.8-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-pro-preview',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite-preview',
      ]);
    });

    it('should return MiniMax models when API key is configured', async () => {
      const { getAvailableModelsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettingsSync();
      settings.api_keys.minimax = 'minimax-test-key';

      const available = getAvailableModelsSync(settings);

      expect(available.minimax).toEqual(['MiniMax-M3', 'minimax-m2.7', 'minimax-m2.7-highspeed']);
    });

    it('should return Kimi models when API key is configured', async () => {
      const { getAvailableModelsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettingsSync();
      settings.api_keys.kimi = 'kimi-test-key';

      const available = getAvailableModelsSync(settings);

      expect(available.kimi).toEqual(['k3', 'k3[1m]', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5', 'K2.6-code-preview']);
    });

    it('should return xAI models when XAI_API_KEY is configured', async () => {
      const { getAvailableModelsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettingsSync();
      settings.api_keys.xai = 'xai-test-key';

      const available = getAvailableModelsSync(settings);

      expect(available.xai).toEqual(['grok-build-0.1']);
    });

    it('should return multiple providers when multiple API keys configured', async () => {
      const { getAvailableModelsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      const settings = getDefaultSettingsSync();
      settings.api_keys.openai = 'sk-test-key';
      settings.api_keys.google = 'AIza-test-key';
      settings.api_keys.minimax = 'minimax-test-key';

      const available = getAvailableModelsSync(settings);

      expect(available.anthropic.length).toBeGreaterThan(0);
      expect(available.openai.length).toBeGreaterThan(0);
      expect(available.google.length).toBeGreaterThan(0);
      expect(available.minimax.length).toBeGreaterThan(0);
    });

    it('should gate QuantumLlama models on the quantumllama API key (PAN-3252)', async () => {
      const { getAvailableModelsSync, getDefaultSettingsSync } = await import('../../src/lib/settings.js');

      const without = getAvailableModelsSync(getDefaultSettingsSync());
      expect(without.quantumllama).toEqual([]);

      const settings = getDefaultSettingsSync();
      settings.api_keys.quantumllama = 'ql-test-key';
      const available = getAvailableModelsSync(settings);
      expect(available.quantumllama).toEqual(['ql-reason-70b', 'ql-swift-8b', 'ql-nano-1b']);
    });

    it('should fall back to QUANTUMLLAMA_API_KEY from the environment', async () => {
      const { loadSettingsSync } = await import('../../src/lib/settings.js');

      process.env.QUANTUMLLAMA_API_KEY = 'ql-env-key';
      try {
        const loaded = loadSettingsSync();
        expect(loaded.api_keys.quantumllama).toBe('ql-env-key');
      } finally {
        delete process.env.QUANTUMLLAMA_API_KEY;
      }
    });
  });
});
