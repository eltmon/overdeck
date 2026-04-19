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
  createSessionAsync: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn().mockResolvedValue(undefined),
  killSessionAsync: vi.fn().mockResolvedValue(undefined),
  sendKeys: vi.fn().mockResolvedValue(undefined),
  sessionExists: vi.fn().mockReturnValue(false),
  sessionExistsAsync: vi.fn().mockResolvedValue(false),
  getAgentSessions: vi.fn().mockResolvedValue([]),
  listPaneValuesAsync: vi.fn().mockResolvedValue([]),
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
      config: {
        preset: 'balanced',
        enabledProviders: new Set(['anthropic', 'openai', 'google']),
        apiKeys: { openai: 'test-openai-key', google: 'test-google-key' },
        overrides: {},
        geminiThinkingLevel: 3,
        caveman: { enabled: false, abTest: false, modes: { work: 'full', review: 'review', test: 'full', merge: 'full' } },
      } as NormalizedConfig,
    }),
  };
});

describe('agent spawning with work types', () => {
  let testPanopticonHome: string;
  let testAgentsDir: string;
  const originalPanopticonHome = process.env.PANOPTICON_HOME;

  beforeEach(async () => {
    // Create unique temp directory for panopticon home
    testPanopticonHome = join(tmpdir(), `pan-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testAgentsDir = join(testPanopticonHome, 'agents');
    mkdirSync(testAgentsDir, { recursive: true });

    // Override PANOPTICON_HOME for tests (must be set before importing paths module)
    process.env.PANOPTICON_HOME = testPanopticonHome;

    // Clear all mocks
    vi.clearAllMocks();

    // Reset sessionExistsAsync to default false (tests that need true override it)
    const { sessionExistsAsync } = await import('../../src/lib/tmux.js');
    vi.mocked(sessionExistsAsync).mockResolvedValue(false);
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
  });

  describe('explicit model override', () => {
    it('should use explicitly provided model over work type routing', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-9',
        workspace: '/tmp/test-workspace',
        phase: 'implementation', // Would normally get a strong model
        model: 'claude-haiku-4', // But we force a different one
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-9');
      expect(state.model).toBe('claude-haiku-4');
      expect(state.phase).toBe('implementation');
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
              high: 'claude-opus-4-6',
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
      const { sessionExistsAsync } = await import('../../src/lib/tmux.js');
      vi.mocked(sessionExistsAsync).mockResolvedValue(true);

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

  describe('SageOx environment variables', () => {
    let sageoxProjectRoot: string;
    let sageoxWorkspace: string;

    beforeEach(async () => {
      // Reset the sessionExists mock to return false for these tests
      const { sessionExists } = await import('../../src/lib/tmux.js');
      vi.mocked(sessionExists).mockReturnValue(false);

      // Create a project structure with .sageox/ so SageOx vars are injected
      // Workspace path resolves to projectRoot via resolve(workspace, '..', '..')
      sageoxProjectRoot = join(tmpdir(), `pan-sageox-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sageoxWorkspace = join(sageoxProjectRoot, 'workspaces', 'feature-test');
      mkdirSync(join(sageoxProjectRoot, '.sageox'), { recursive: true });
      mkdirSync(sageoxWorkspace, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(sageoxProjectRoot)) {
        rmSync(sageoxProjectRoot, { recursive: true, force: true });
      }
    });

    it('should pass OX_PROJECT_ROOT when .sageox/ exists', async () => {
      const { createSessionAsync } = await import('../../src/lib/tmux.js');

      const options: SpawnOptions = {
        issueId: 'PAN-SAGOX-1',
        workspace: sageoxWorkspace,
        phase: 'implementation',
      };

      await spawnAgent(options);

      expect(createSessionAsync).toHaveBeenCalled();
      const callArgs = vi.mocked(createSessionAsync).mock.calls[0];
      const envArg = callArgs[3]?.env as Record<string, string>;

      expect(envArg.OX_PROJECT_ROOT).toBe(sageoxProjectRoot);
    });

    it('should NOT set SageOx vars when .sageox/ does not exist', async () => {
      const { createSessionAsync } = await import('../../src/lib/tmux.js');

      // Use a workspace path that resolves to a project root without .sageox/
      const noSageoxRoot = join(tmpdir(), `pan-nosageox-${Date.now()}`);
      const noSageoxWorkspace = join(noSageoxRoot, 'workspaces', 'feature-test');
      mkdirSync(noSageoxWorkspace, { recursive: true });

      const options: SpawnOptions = {
        issueId: 'PAN-SAGOX-NO',
        workspace: noSageoxWorkspace,
        phase: 'implementation',
      };

      await spawnAgent(options);

      const callArgs = vi.mocked(createSessionAsync).mock.calls[0];
      const envArg = callArgs[3]?.env as Record<string, string>;

      // SageOx vars should NOT be present
      expect(envArg.OX_PROJECT_ROOT).toBeUndefined();
      expect(envArg.PAN_ISSUE_ID).toBeUndefined();
      expect(envArg.PAN_PHASE).toBeUndefined();

      // Panopticon vars should still be present
      expect(envArg.PANOPTICON_AGENT_ID).toBe('agent-pan-sagox-no');

      rmSync(noSageoxRoot, { recursive: true, force: true });
    });

    it('should pass PAN_ISSUE_ID and PAN_PHASE for multi-agent pipeline', async () => {
      const { createSessionAsync } = await import('../../src/lib/tmux.js');

      const options: SpawnOptions = {
        issueId: 'PAN-SAGOX-2',
        workspace: sageoxWorkspace,
        phase: 'review',
      };

      await spawnAgent(options);

      const callArgs = vi.mocked(createSessionAsync).mock.calls[0];
      const envArg = callArgs[3]?.env as Record<string, string>;

      expect(envArg.PAN_ISSUE_ID).toBe('PAN-SAGOX-2');
      expect(envArg.PAN_PHASE).toBe('review');
    });

    it('should include SageOx vars alongside existing env vars', async () => {
      const { createSessionAsync } = await import('../../src/lib/tmux.js');

      const options: SpawnOptions = {
        issueId: 'PAN-SAGOX-3',
        workspace: sageoxWorkspace,
        phase: 'planning',
      };

      await spawnAgent(options);

      const callArgs = vi.mocked(createSessionAsync).mock.calls[0];
      const envArg = callArgs[3]?.env as Record<string, string>;

      // Check existing Panopticon vars are still present
      expect(envArg.PANOPTICON_AGENT_ID).toBe('agent-pan-sagox-3');
      expect(envArg.PANOPTICON_ISSUE_ID).toBe('PAN-SAGOX-3');
      expect(envArg.PANOPTICON_SESSION_TYPE).toBe('planning');

      // Check SageOx vars are present
      expect(envArg.OX_PROJECT_ROOT).toBe(sageoxProjectRoot);
      expect(envArg.PAN_ISSUE_ID).toBe('PAN-SAGOX-3');
      expect(envArg.PAN_PHASE).toBe('planning');
    });

    it('should not set PAN_PARENT_SESSION for planner agents', async () => {
      const { createSessionAsync } = await import('../../src/lib/tmux.js');

      const options: SpawnOptions = {
        issueId: 'PAN-SAGOX-4',
        workspace: sageoxWorkspace,
        phase: 'planning',
      };

      await spawnAgent(options);

      const callArgs = vi.mocked(createSessionAsync).mock.calls[0];
      const envArg = callArgs[3]?.env as Record<string, string>;

      // Planner agents should not have PAN_PARENT_SESSION
      expect(envArg.PAN_PARENT_SESSION).toBeUndefined();
    });

    it('should attempt to look up planner session for non-planner phases', async () => {
      const { createSessionAsync } = await import('../../src/lib/tmux.js');

      const options: SpawnOptions = {
        issueId: 'PAN-SAGOX-5',
        workspace: sageoxWorkspace,
        phase: 'implementation',
      };

      // Should complete without error even when planner doesn't exist
      await expect(spawnAgent(options)).resolves.not.toThrow();

      // Verify session was created
      expect(createSessionAsync).toHaveBeenCalled();
    });
  });
});
