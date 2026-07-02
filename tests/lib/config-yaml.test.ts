import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  loadConfigSync,
  hasProjectConfig,
  hasGlobalConfig,
  getGlobalConfigPath,
  getProjectConfigPath,
  mergeConfigs,
  mergeRtkConfigs,
} from '../../src/lib/config-yaml.js';

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

    it('normalizes provider default harnesses from object provider config', () => {
      const { config } = mergeConfigs({
        models: {
          providers: {
            openai: { enabled: true, harness: 'codex' },
          },
        },
      });

      expect(config.enabledProviders.has('openai')).toBe(true);
      expect(config.providerHarnesses.openai).toBe('codex');
    });

    it('rejects invalid provider default harnesses', () => {
      expect(() => mergeConfigs({
        models: {
          providers: {
            openai: { enabled: true, harness: 'bad' as never },
          },
        },
      })).toThrow('models.providers.openai.harness must be claude-code, ohmypi, or codex');
    });

    it('normalizes legacy DashScope API keys without re-enabling an explicitly disabled provider', () => {
      const { config } = mergeConfigs({
        models: { providers: { anthropic: false, dashscope: false } },
        api_keys: { dashscope: 'dashscope-test-key' },
      });

      expect(config.apiKeys.dashscope).toBe('dashscope-test-key');
      expect(config.enabledProviders.has('dashscope')).toBe(false);
    });

    it('normalizes RTK agent config with default-off precedence', () => {
      expect(mergeRtkConfigs().enabled).toBe(false);

      const { config } = mergeConfigs({
        agents: {
          rtk: { enabled: true },
        },
      });

      expect(config.rtk.enabled).toBe(true);
      expect(
        mergeRtkConfigs({ agents: { rtk: { enabled: true } } }).enabled,
      ).toBe(true);
      expect(
        mergeRtkConfigs(
          { agents: { rtk: { enabled: true } } },
          { agents: { rtk: { enabled: false } } },
        ).enabled,
      ).toBe(false);
    });

    it('normalizes compliance mode with advisory as the default', () => {
      expect(mergeConfigs().config.compliance.mode).toBe('advisory');
      expect(mergeConfigs({ compliance: { mode: 'off' } }).config.compliance.mode).toBe('off');
      expect(mergeConfigs({ compliance: { mode: 'advisory' } }).config.compliance.mode).toBe('advisory');
      expect(mergeConfigs({ compliance: { mode: 'enforcing' } }).config.compliance.mode).toBe('enforcing');
    });

    it('rejects unknown compliance modes', () => {
      expect(() => mergeConfigs({ compliance: { mode: 'strict' } } as never)).toThrow(
        'config.yaml: compliance.mode must be off, advisory, enforcing',
      );
    });

    it('defaults tiered execution off when the block is absent', () => {
      const { config } = mergeConfigs({});

      expect(config.tieredExecution.enabled).toBe(false);
      expect(config.tieredExecution.replay_threshold).toBe(0.5);
      expect(config.tieredExecution.tiers).toEqual({});
    });

    it('loads and validates a complete tiered execution block', () => {
      const { config } = mergeConfigs({
        tiered_execution: {
          enabled: true,
          replay_threshold: 0.75,
          tiers: {
            cheap: {
              model: 'claude-haiku-4-5',
              harness: 'claude-code',
              difficulties: ['trivial', 'simple'],
            },
            standard: {
              model: 'claude-sonnet-4-6',
              harness: 'claude-code',
              difficulties: ['medium', 'complex'],
            },
            premium: {
              model: 'claude-opus-4-7',
              harness: 'claude-code',
              difficulties: ['expert'],
            },
          },
          supervisor: {
            model: 'claude-opus-4-7',
            harness: 'claude-code',
            subscribe: 'sampled',
          },
        },
      });

      expect(config.tieredExecution.enabled).toBe(true);
      expect(config.tieredExecution.replay_threshold).toBe(0.75);
      expect('difficultyToTier' in config.tieredExecution ? config.tieredExecution.difficultyToTier : undefined).toEqual({
        trivial: 'cheap',
        simple: 'cheap',
        medium: 'standard',
        complex: 'standard',
        expert: 'premium',
      });
      expect(config.tieredExecution.supervisor).toEqual({
        model: 'claude-opus-4-7',
        harness: 'claude-code',
        subscribe: 'sampled',
      });
    });

    it('rejects tiered execution blocks with unknown models, unknown harnesses, or blocked policy', () => {
      expect(() => mergeConfigs({
        tiered_execution: {
          tiers: {
            cheap: { model: 'not-a-model', harness: 'claude-code', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] },
          },
          supervisor: { model: 'claude-opus-4-7', harness: 'claude-code', subscribe: 'all' },
        },
      })).toThrow('tiered_execution.tiers.cheap.model unknown model: not-a-model');

      expect(() => mergeConfigs({
        tiered_execution: {
          tiers: {
            cheap: { model: 'claude-haiku-4-5', harness: 'bad' as never, difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] },
          },
          supervisor: { model: 'claude-opus-4-7', harness: 'claude-code', subscribe: 'all' },
        },
      })).toThrow('tiered_execution.tiers.cheap.harness must be claude-code, ohmypi, codex');

      expect(() => mergeConfigs({
        models: {
          providers: {
            anthropic: { enabled: true, auth: 'subscription' },
          },
        },
        tiered_execution: {
          tiers: {
            cheap: { model: 'claude-haiku-4-5', harness: 'ohmypi', difficulties: ['trivial', 'simple', 'medium', 'complex', 'expert'] },
          },
          supervisor: { model: 'claude-opus-4-7', harness: 'claude-code', subscribe: 'all' },
        },
      })).toThrow('ohmypi cannot run Anthropic models when authenticated via Claude Code subscription');
    });

    it('normalizes low-cost registry classification config', () => {
      expect(mergeConfigs().config.registry.classification).toEqual({
        enabled: true,
        provider: 'cliproxy',
        model: 'gpt-4.1-nano',
        perDayCostCapUsd: 1,
      });

      expect(mergeConfigs({
        registry: {
          classification: {
            enabled: false,
            provider: 'anthropic',
            model: 'claude-haiku-4-5',
            per_day_cost_cap_usd: 0.25,
          },
        },
      }).config.registry.classification).toEqual({
        enabled: false,
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        perDayCostCapUsd: 0.25,
      });
    });

    it('normalizes remote tier and concurrency settings', () => {
      expect(mergeConfigs().config.remote).toBeUndefined();

      const { config } = mergeConfigs({
        remote: {
          resiliency_tier: 'durable',
          max_concurrent_agents: 5,
        },
      });

      expect(config.remote).toEqual({
        resiliencyTier: 'durable',
        maxConcurrentAgents: 5,
      });
    });

    it('rejects invalid remote settings', () => {
      expect(() => mergeConfigs({
        remote: { resiliency_tier: 'permanent' },
      } as never)).toThrow('config.yaml: remote.resiliency_tier must be one of ephemeral, durable');

      expect(() => mergeConfigs({
        remote: { max_concurrent_agents: -1 },
      } as never)).toThrow('config.yaml: remote.max_concurrent_agents must be a non-negative integer');

      expect(() => mergeConfigs({
        remote: { max_concurrent_agents: 1.5 },
      } as never)).toThrow('config.yaml: remote.max_concurrent_agents must be a non-negative integer');
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
      expect(path).toContain('.overdeck');
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
});
