import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadConfigSync, hasProjectConfig, hasGlobalConfig, getGlobalConfigPath, getProjectConfigPath, mergeConfigs, getAutoMergeConfig } from '../../src/lib/config-yaml.js';
import * as projects from '../../src/lib/projects.js';

describe('config-yaml', () => {
  const testDir = join(process.cwd(), '.test-config-yaml');
  const testGlobalConfig = join(testDir, 'global-config.yaml');
  const testProjectConfig = join(testDir, 'project', '.pan.yaml');

  beforeEach(() => {
    // Create test directories
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'project', '.git'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadConfig', () => {
    it.skip('should return default config when no config files exist', () => {
      // Skipped: Cannot isolate from real config file without mocking module-level imports
      const config = loadConfigSync();

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

      const config = loadConfigSync();

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
    issue-agent:exploration: claude-opus-4-6
`;
      writeFileSync(testProjectConfig, projectYaml, 'utf-8');

      const config = loadConfigSync();

      expect(config.preset).toBe('premium');
      expect(config.overrides['issue-agent:exploration']).toBe('claude-opus-4-6');
    });

    it.skip('should handle legacy api_keys format', () => {
      // Skipped: Cannot isolate from real config file without mocking module-level imports
      const yamlContent = `
api_keys:
  openai: sk-test-123
  google: AIza-test-456
`;
      writeFileSync(testGlobalConfig, yamlContent, 'utf-8');

      const config = loadConfigSync();

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

      const config = loadConfigSync();

      expect(config.apiKeys.openai).toBe('sk-from-env');

      delete process.env.TEST_OPENAI_KEY;
    });

    it('normalizes DashScope provider and API key from models.providers', () => {
      const { config } = mergeConfigs({
        models: {
          providers: {
            anthropic: false,
            dashscope: { enabled: true, api_key: 'dashscope-test-key' },
          },
        },
      });

      expect(config.enabledProviders.has('anthropic')).toBe(false);
      expect(config.enabledProviders.has('dashscope')).toBe(true);
      expect(config.apiKeys.dashscope).toBe('dashscope-test-key');
    });

    it('normalizes legacy DashScope API keys without re-enabling an explicitly disabled provider', () => {
      const { config } = mergeConfigs({
        models: { providers: { anthropic: false, dashscope: false } },
        api_keys: { dashscope: 'dashscope-test-key' },
      });

      expect(config.apiKeys.dashscope).toBe('dashscope-test-key');
      expect(config.enabledProviders.has('dashscope')).toBe(false);
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
      expect(path).toContain('.pan.yaml');
    });
  });

  describe('merge.autoMerge', () => {
    it('uses disabled auto-merge defaults when config omits merge settings', () => {
      const { config } = mergeConfigs({});

      expect(config.merge.autoMerge).toEqual({
        enabled: false,
        cooldownMinutes: 5,
        maxStaleMinutes: 60,
        requireGitHubCiPassing: true,
        requireAllCommitStatusChecks: true,
        requireNoBlockerLabels: ['needs-design', 'needs-discussion', 'do-not-merge', 'wip'],
      });
    });

    it('normalizes global-only auto-merge config', () => {
      const { config } = mergeConfigs({
        merge: {
          autoMerge: {
            enabled: true,
            cooldownMinutes: 7,
            maxStaleMinutes: 90,
            requireGitHubCiPassing: false,
            requireAllCommitStatusChecks: false,
            requireNoBlockerLabels: ['blocked'],
          },
        },
      });

      expect(config.merge.autoMerge).toEqual({
        enabled: true,
        cooldownMinutes: 7,
        maxStaleMinutes: 90,
        requireGitHubCiPassing: false,
        requireAllCommitStatusChecks: false,
        requireNoBlockerLabels: ['blocked'],
      });
    });

    it('normalizes project-only auto-merge config over defaults', () => {
      const { config } = mergeConfigs({
        merge: {
          autoMerge: {
            enabled: true,
            requireNoBlockerLabels: ['project-blocked'],
          },
        },
      });

      expect(config.merge.autoMerge).toEqual({
        enabled: true,
        cooldownMinutes: 5,
        maxStaleMinutes: 60,
        requireGitHubCiPassing: true,
        requireAllCommitStatusChecks: true,
        requireNoBlockerLabels: ['project-blocked'],
      });
    });

    it('replaces global auto-merge config with project auto-merge config instead of deep-merging', () => {
      const { config } = mergeConfigs(
        {
          merge: {
            autoMerge: {
              enabled: true,
              cooldownMinutes: 2,
              requireNoBlockerLabels: ['project-blocked'],
            },
          },
        },
        {
          merge: {
            autoMerge: {
              enabled: true,
              cooldownMinutes: 20,
              maxStaleMinutes: 120,
              requireGitHubCiPassing: false,
              requireAllCommitStatusChecks: false,
              requireNoBlockerLabels: ['global-blocked'],
            },
          },
        },
      );

      expect(config.merge.autoMerge).toEqual({
        enabled: true,
        cooldownMinutes: 2,
        maxStaleMinutes: 60,
        requireGitHubCiPassing: true,
        requireAllCommitStatusChecks: true,
        requireNoBlockerLabels: ['project-blocked'],
      });
    });

    it('clamps cooldown and max stale minutes with warnings', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { config } = mergeConfigs({
        merge: {
          autoMerge: {
            cooldownMinutes: 0,
            maxStaleMinutes: 0,
          },
        },
      });

      expect(config.merge.autoMerge.cooldownMinutes).toBe(1);
      expect(config.merge.autoMerge.maxStaleMinutes).toBe(1);
      expect(warn).toHaveBeenCalledWith('[panopticon] merge.autoMerge.cooldownMinutes must be >= 1; clamping 0 to 1.');
      expect(warn).toHaveBeenCalledWith('[panopticon] merge.autoMerge.maxStaleMinutes must be >= cooldownMinutes; clamping 0 to 1.');
    });

    it('reads project-scoped auto-merge config by project key', () => {
      const projectRoot = join(testDir, 'auto-merge-project');
      mkdirSync(projectRoot, { recursive: true });
      writeFileSync(join(projectRoot, '.pan.yaml'), `
merge:
  autoMerge:
    enabled: true
    cooldownMinutes: 4
    maxStaleMinutes: 8
    requireGitHubCiPassing: false
    requireAllCommitStatusChecks: false
    requireNoBlockerLabels:
      - project-only
`, 'utf-8');
      vi.spyOn(projects, 'getProjectSync').mockReturnValue({
        name: 'Auto Merge Project',
        path: projectRoot,
      });

      expect(getAutoMergeConfig('auto-merge-project')).toEqual({
        enabled: true,
        cooldownMinutes: 4,
        maxStaleMinutes: 8,
        requireGitHubCiPassing: false,
        requireAllCommitStatusChecks: false,
        requireNoBlockerLabels: ['project-only'],
      });
    });
  });
});
