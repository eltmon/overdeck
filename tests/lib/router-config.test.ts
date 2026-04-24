import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { SettingsConfig } from '../../src/lib/settings.js';

// Mock os.homedir to return our temp directory
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => process.env.TEST_HOME_DIR || actual.homedir(),
  };
});

describe('router-config', () => {
  let tempDir: string;
  let originalTestHome: string | undefined;

  beforeEach(() => {
    // Create temp directory for isolated tests
    tempDir = mkdtempSync(join(tmpdir(), 'pan-router-test-'));

    // Set TEST_HOME_DIR to control homedir() in mocked os module
    originalTestHome = process.env.TEST_HOME_DIR;
    process.env.TEST_HOME_DIR = tempDir;

    // Clear module cache to reload with new env var
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env var
    if (originalTestHome) {
      process.env.TEST_HOME_DIR = originalTestHome;
    } else {
      delete process.env.TEST_HOME_DIR;
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateRouterConfig', () => {
    it('should always include Anthropic provider', async () => {
      const { generateRouterConfig } = await import('../../src/lib/router-config.js');

      const settings: SettingsConfig = {
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
        api_keys: {},
      };

      const config = generateRouterConfig(settings);

      expect(config.providers).toHaveLength(1);
      expect(config.providers[0].name).toBe('anthropic');
      expect(config.providers[0].baseURL).toBe('https://api.anthropic.com/v1');
      expect(config.providers[0].apiKey).toBe('$ANTHROPIC_API_KEY');
      expect(config.providers[0].models).toEqual([
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
      ]);
    });

    it('should include OpenAI provider when API key configured', async () => {
      const { generateRouterConfig } = await import('../../src/lib/router-config.js');

      const settings: SettingsConfig = {
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
        api_keys: {
          openai: 'sk-test-key',
        },
      };

      const config = generateRouterConfig(settings);

      expect(config.providers).toHaveLength(2);

      const openaiProvider = config.providers.find((p) => p.name === 'openai');
      expect(openaiProvider).toBeDefined();
      expect(openaiProvider?.baseURL).toBe('https://api.openai.com/v1');
      expect(openaiProvider?.apiKey).toBe('sk-test-key');
      expect(openaiProvider?.models).toEqual([
        'gpt-5.5',
        'gpt-5.5-mini',
        'gpt-5.5-nano',
        'gpt-5.5-pro',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
        'gpt-5.4-pro',
        'o3',
      ]);
    });

    it('should include Google provider when API key configured', async () => {
      const { generateRouterConfig } = await import('../../src/lib/router-config.js');

      const settings: SettingsConfig = {
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
        api_keys: {
          google: 'AIza-test-key',
        },
      };

      const config = generateRouterConfig(settings);

      expect(config.providers).toHaveLength(2);

      const googleProvider = config.providers.find((p) => p.name === 'google');
      expect(googleProvider).toBeDefined();
      expect(googleProvider?.baseURL).toBe('https://generativelanguage.googleapis.com/v1beta');
      expect(googleProvider?.apiKey).toBe('AIza-test-key');
      expect(googleProvider?.models).toEqual([
        'gemini-3.1-pro-preview',
        'gemini-3-flash',
        'gemini-3.1-flash-lite-preview',
      ]);
    });

    it('should NOT include Z.AI provider (uses direct API, not router)', async () => {
      const { generateRouterConfig } = await import('../../src/lib/router-config.js');

      const settings: SettingsConfig = {
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
        api_keys: {
          zai: 'zai-test-key',
        },
      };

      const config = generateRouterConfig(settings);

      // Z.AI is intentionally excluded - it uses direct API, not the router
      expect(config.providers).toHaveLength(1);
      expect(config.providers[0].name).toBe('anthropic');
    });

    it('should include all router-supported providers when all API keys configured', async () => {
      const { generateRouterConfig } = await import('../../src/lib/router-config.js');

      const settings: SettingsConfig = {
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
        api_keys: {
          openai: 'sk-test-key',
          google: 'AIza-test-key',
          zai: 'zai-test-key', // Z.AI uses direct API, not router
        },
      };

      const config = generateRouterConfig(settings);

      // 3 providers: anthropic (always) + openai + google
      // Z.AI is intentionally excluded (uses direct API, not router)
      expect(config.providers).toHaveLength(3);
      expect(config.providers.map((p) => p.name)).toEqual(
        expect.arrayContaining(['anthropic', 'openai', 'google'])
      );
    });

    it('should support environment variable syntax for API keys', async () => {
      const { generateRouterConfig } = await import('../../src/lib/router-config.js');

      const settings: SettingsConfig = {
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
        api_keys: {
          openai: '$OPENAI_API_KEY',
          google: '${GOOGLE_API_KEY}',
        },
      };

      const config = generateRouterConfig(settings);

      const openaiProvider = config.providers.find((p) => p.name === 'openai');
      const googleProvider = config.providers.find((p) => p.name === 'google');

      expect(openaiProvider?.apiKey).toBe('$OPENAI_API_KEY');
      expect(googleProvider?.apiKey).toBe('${GOOGLE_API_KEY}');
    });

    it('should map specialist agents to configured models', async () => {
      const { generateRouterConfig } = await import('../../src/lib/router-config.js');

      const settings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'gpt-4o-mini',
            merge_agent: 'gemini-3-flash-preview',
          },
          complexity: {
            trivial: 'claude-haiku-4-5',
            simple: 'claude-haiku-4-5',
            medium: 'claude-sonnet-4-5',
            complex: 'claude-sonnet-4-5',
            expert: 'claude-opus-4-6',
          },
        },
        api_keys: {
          openai: 'sk-test-key',
          google: 'AIza-test-key',
        },
      };

      const config = generateRouterConfig(settings);

      expect(config.router['specialist-review-agent'].model).toBe('claude-sonnet-4-5');
      expect(config.router['specialist-test-agent'].model).toBe('gpt-4o-mini');
      expect(config.router['specialist-merge-agent'].model).toBe('gemini-3-flash-preview');
    });

    it('should map complexity levels to configured models', async () => {
      const { generateRouterConfig } = await import('../../src/lib/router-config.js');

      const settings: SettingsConfig = {
        models: {
          specialists: {
            review_agent: 'claude-sonnet-4-5',
            test_agent: 'claude-haiku-4-5',
            merge_agent: 'claude-sonnet-4-5',
          },
          complexity: {
            trivial: 'gpt-4o-mini',
            simple: 'claude-haiku-4-5',
            medium: 'gpt-4o',
            complex: 'claude-sonnet-4-5',
            expert: 'gpt-5.2-codex',
          },
        },
        api_keys: {
          openai: 'sk-test-key',
        },
      };

      const config = generateRouterConfig(settings);

      expect(config.router['complexity-trivial'].model).toBe('gpt-4o-mini');
      expect(config.router['complexity-simple'].model).toBe('claude-haiku-4-5');
      expect(config.router['complexity-medium'].model).toBe('gpt-4o');
      expect(config.router['complexity-complex'].model).toBe('claude-sonnet-4-5');
      expect(config.router['complexity-expert'].model).toBe('gpt-5.2-codex');
    });

    it('should create all router rules', async () => {
      const { generateRouterConfig } = await import('../../src/lib/router-config.js');

      const settings: SettingsConfig = {
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
        api_keys: {},
      };

      const config = generateRouterConfig(settings);

      // Should have 3 specialists + 5 complexity = 8 rules (planning removed)
      expect(Object.keys(config.router)).toHaveLength(8);
      expect(config.router).toHaveProperty('specialist-review-agent');
      expect(config.router).toHaveProperty('specialist-test-agent');
      expect(config.router).toHaveProperty('specialist-merge-agent');
      expect(config.router).toHaveProperty('complexity-trivial');
      expect(config.router).toHaveProperty('complexity-simple');
      expect(config.router).toHaveProperty('complexity-medium');
      expect(config.router).toHaveProperty('complexity-complex');
      expect(config.router).toHaveProperty('complexity-expert');
    });
  });

  describe('writeRouterConfig', () => {
    it('should write config to ~/.claude-code-router/config.json', async () => {
      const { writeRouterConfig, getRouterConfigPath } = await import('../../src/lib/router-config.js');

      const config = {
        providers: [
          {
            name: 'anthropic',
            baseURL: 'https://api.anthropic.com/v1',
            apiKey: '$ANTHROPIC_API_KEY',
            models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
          },
        ],
        router: {
          'specialist-review-agent': { model: 'claude-sonnet-4-6' },
        },
      };

      writeRouterConfig(config);

      const configPath = getRouterConfigPath();
      expect(existsSync(configPath)).toBe(true);

      // Verify content is valid JSON
      const content = readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(config);
    });

    it('should create directory if it does not exist', async () => {
      const { writeRouterConfig, getRouterConfigPath } = await import('../../src/lib/router-config.js');

      const config = {
        providers: [],
        router: {},
      };

      // Directory should not exist yet
      const configPath = getRouterConfigPath();
      const configDir = join(tempDir, '.claude-code-router');
      expect(existsSync(configDir)).toBe(false);

      writeRouterConfig(config);

      // Directory should now exist
      expect(existsSync(configDir)).toBe(true);
      expect(existsSync(configPath)).toBe(true);
    });

    it('should write pretty-formatted JSON', async () => {
      const { writeRouterConfig, getRouterConfigPath } = await import('../../src/lib/router-config.js');

      const config = {
        providers: [
          {
            name: 'anthropic',
            baseURL: 'https://api.anthropic.com/v1',
            apiKey: '$ANTHROPIC_API_KEY',
            models: ['claude-opus-4-6'],
          },
        ],
        router: {
          'specialist-review-agent': { model: 'claude-sonnet-4-6' },
        },
      };

      writeRouterConfig(config);

      const configPath = getRouterConfigPath();
      const content = readFileSync(configPath, 'utf8');

      // Pretty-formatted JSON should have newlines and indentation
      expect(content).toContain('\n');
      expect(content).toContain('  '); // 2-space indent
    });

    it('should overwrite existing config', async () => {
      const { writeRouterConfig, getRouterConfigPath } = await import('../../src/lib/router-config.js');

      const config1 = {
        providers: [],
        router: { test: { model: 'model1' } },
      };

      const config2 = {
        providers: [],
        router: { test: { model: 'model2' } },
      };

      writeRouterConfig(config1);
      writeRouterConfig(config2);

      const configPath = getRouterConfigPath();
      const content = readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.router.test.model).toBe('model2');
    });
  });

  describe('getRouterConfigPath', () => {
    it('should return path in home directory', async () => {
      const { getRouterConfigPath } = await import('../../src/lib/router-config.js');

      const path = getRouterConfigPath();

      expect(path).toContain('.claude-code-router');
      expect(path).toContain('config.json');
      expect(path).toBe(join(tempDir, '.claude-code-router', 'config.json'));
    });
  });
});
