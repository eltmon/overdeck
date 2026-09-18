import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

  describe('writeRouterConfig', () => {
    it('should write config to ~/.claude-code-router/config.json', async () => {
      const { writeRouterConfigSync, getRouterConfigPath } = await import('../../src/lib/router-config.js');

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

      writeRouterConfigSync(config);

      const configPath = getRouterConfigPath();
      expect(existsSync(configPath)).toBe(true);

      // Verify content is valid JSON
      const content = readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(config);
    });

    it('should create directory if it does not exist', async () => {
      const { writeRouterConfigSync, getRouterConfigPath } = await import('../../src/lib/router-config.js');

      const config = {
        providers: [],
        router: {},
      };

      // Directory should not exist yet
      const configPath = getRouterConfigPath();
      const configDir = join(tempDir, '.claude-code-router');
      expect(existsSync(configDir)).toBe(false);

      writeRouterConfigSync(config);

      // Directory should now exist
      expect(existsSync(configDir)).toBe(true);
      expect(existsSync(configPath)).toBe(true);
    });

    it('should write pretty-formatted JSON', async () => {
      const { writeRouterConfigSync, getRouterConfigPath } = await import('../../src/lib/router-config.js');

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

      writeRouterConfigSync(config);

      const configPath = getRouterConfigPath();
      const content = readFileSync(configPath, 'utf8');

      // Pretty-formatted JSON should have newlines and indentation
      expect(content).toContain('\n');
      expect(content).toContain('  '); // 2-space indent
    });

    it('should overwrite existing config', async () => {
      const { writeRouterConfigSync, getRouterConfigPath } = await import('../../src/lib/router-config.js');

      const config1 = {
        providers: [],
        router: { test: { model: 'model1' } },
      };

      const config2 = {
        providers: [],
        router: { test: { model: 'model2' } },
      };

      writeRouterConfigSync(config1);
      writeRouterConfigSync(config2);

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
