/**
 * Integration tests for agent spawning with work types
 *
 * Tests the end-to-end flow of spawning agents with work type routing:
 * 1. Agent spawns with correct model based on work type
 * 2. Phase-based routing works correctly
 * 3. Specialist agents use correct work types
 * 4. Explicit model overrides take precedence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnAgent, getAgentState, type SpawnOptions, getAgentDir } from '../../src/lib/agents.js';
import { WorkTypeId } from '../../src/lib/work-types.js';
import type { NormalizedConfig } from '../../src/lib/config-yaml.js';

// Mock tmux module to avoid actual session creation
vi.mock('../../src/lib/tmux.js', () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn().mockResolvedValue(undefined),
  sendKeys: vi.fn().mockResolvedValue(undefined),
  sessionExists: vi.fn().mockReturnValue(false),
  getAgentSessions: vi.fn().mockResolvedValue([]),
}));

// Mock hooks module
vi.mock('../../src/lib/hooks.js', () => ({
  initHook: vi.fn(),
  checkHook: vi.fn().mockReturnValue({ allowed: true, hasWork: false }),
  generateFixedPointPrompt: vi.fn().mockReturnValue(''),
  checkAndSetupHooks: vi.fn(),
  writeTaskCache: vi.fn(),
}));

// Mock CV module
vi.mock('../../src/lib/cv.js', () => ({
  startWork: vi.fn(),
  completeWork: vi.fn(),
  getAgentCV: vi.fn().mockReturnValue(null),
}));

// Mock config loading
vi.mock('../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      preset: 'balanced',
      enabledProviders: new Set(['anthropic', 'openai', 'google']),
      apiKeys: {},
      overrides: {},
      geminiThinkingLevel: 3,
    } as NormalizedConfig),
  };
});

describe('agent spawning with work types', () => {
  let testPanopticonHome: string;
  let testAgentsDir: string;
  const originalPanopticonHome = process.env.PANOPTICON_HOME;

  beforeEach(() => {
    // Create unique temp directory for panopticon home
    testPanopticonHome = join(tmpdir(), `pan-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testAgentsDir = join(testPanopticonHome, 'agents');
    mkdirSync(testAgentsDir, { recursive: true });

    // Override PANOPTICON_HOME for tests (must be set before importing paths module)
    process.env.PANOPTICON_HOME = testPanopticonHome;

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original PANOPTICON_HOME
    if (originalPanopticonHome) {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    } else {
      delete process.env.PANOPTICON_HOME;
    }

    // Clean up temp directory
    if (existsSync(testPanopticonHome)) {
      rmSync(testPanopticonHome, { recursive: true, force: true });
    }
  });

  describe('issue agent phases', () => {
    it('should spawn exploration phase with correct work type', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-1',
        workspace: '/tmp/test-workspace',
        phase: 'exploration',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-1');
      expect(state.phase).toBe('exploration');
      expect(state.model).toBeDefined();
      // Should use fast model for exploration (from balanced preset)
      expect(state.model).toMatch(/gemini|sonnet|haiku/i);
    });

    it('should spawn planning phase with correct work type', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-2',
        workspace: '/tmp/test-workspace',
        phase: 'planning',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-2');
      expect(state.phase).toBe('planning');
      expect(state.model).toBeDefined();
      // Planning should use stronger model
      expect(state.model).toMatch(/opus|pro|sonnet/i);
    });

    it('should spawn implementation phase with correct work type', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-3',
        workspace: '/tmp/test-workspace',
        phase: 'implementation',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-3');
      expect(state.phase).toBe('implementation');
      expect(state.model).toBeDefined();
    });

    it('should spawn testing phase with correct work type', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-4',
        workspace: '/tmp/test-workspace',
        phase: 'testing',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-4');
      expect(state.phase).toBe('testing');
      expect(state.model).toBeDefined();
    });
  });

  describe('specialist agents', () => {
    it('should spawn review agent with correct work type', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-5',
        workspace: '/tmp/test-workspace',
        agentType: 'review-agent',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-5');
      expect(state.model).toBeDefined();
      // Review agent should get appropriate model
      expect(state.model).toMatch(/opus|pro|sonnet/i);
    });

    it('should spawn test agent with correct work type', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-6',
        workspace: '/tmp/test-workspace',
        agentType: 'test-agent',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-6');
      expect(state.model).toBeDefined();
    });

    it('should spawn merge agent with correct work type', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-7',
        workspace: '/tmp/test-workspace',
        agentType: 'merge-agent',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-7');
      expect(state.model).toBeDefined();
    });

    it('should spawn planning agent with correct work type', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-8',
        workspace: '/tmp/test-workspace',
        agentType: 'planning-agent',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-8');
      expect(state.model).toBeDefined();
    });
  });

  describe('explicit model override', () => {
    it('should use explicitly provided model over work type routing', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-9',
        workspace: '/tmp/test-workspace',
        phase: 'planning', // Would normally get a strong model
        model: 'claude-haiku-4', // But we force a different one
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-9');
      expect(state.model).toBe('claude-haiku-4');
      expect(state.phase).toBe('planning');
    });
  });

  describe('explicit work type ID', () => {
    it('should use explicit work type ID for routing', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-10',
        workspace: '/tmp/test-workspace',
        workType: 'dashboard:refactor' as WorkTypeId,
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-10');
      expect(state.workType).toBe('dashboard:refactor');
      expect(state.model).toBeDefined();
    });
  });

  describe('agent state persistence', () => {
    it('should persist agent state to disk', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-11',
        workspace: '/tmp/test-workspace',
        phase: 'implementation',
      };

      await spawnAgent(options);

      // Get the actual agent directory (paths module handles the location)
      const agentDir = getAgentDir('agent-pan-test-11');
      const stateFile = join(agentDir, 'state.json');

      // Check state file exists
      expect(existsSync(stateFile)).toBe(true);

      // Verify state can be read back
      const state = getAgentState('agent-pan-test-11');
      expect(state).toBeDefined();
      expect(state?.issueId).toBe('PAN-TEST-11');
      expect(state?.phase).toBe('implementation');
    });
  });

  describe('legacy complexity routing', () => {
    it('should fall back to complexity routing when no work type specified', async () => {
      // Mock settings to provide complexity-based routing
      vi.mock('../../src/lib/settings.js', () => ({
        loadSettings: vi.fn().mockReturnValue({
          models: {
            complexity: {
              low: 'claude-haiku-4',
              medium: 'claude-sonnet-4-5',
              high: 'claude-opus-4-5',
            },
          },
        }),
      }));

      const options: SpawnOptions = {
        issueId: 'PAN-TEST-12',
        workspace: '/tmp/test-workspace',
        difficulty: 'high',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-12');
      expect(state.model).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should throw error when agent already running', async () => {
      const { sessionExists } = await import('../../src/lib/tmux.js');
      vi.mocked(sessionExists).mockReturnValue(true);

      const options: SpawnOptions = {
        issueId: 'PAN-TEST-13',
        workspace: '/tmp/test-workspace',
        phase: 'implementation',
      };

      await expect(spawnAgent(options)).rejects.toThrow(
        'Agent agent-pan-test-13 already running'
      );
    });
  });
});
