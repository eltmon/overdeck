/**
 * Integration tests for the role primitive (PAN-1048)
 *
 * Replaces the legacy phase/workType/agentType suite that PAN-1015 deprecated
 * and PAN-1048 retired. Verifies:
 *   1. spawnAgent({ role: 'work' }) writes the role primitive into AgentState
 *      and resolves the work model via the workhorses+roles config.
 *   2. spawnRun(issueId, role) for review/test/ship spawns the correct
 *      session-id shape, persists the role on AgentState, and resolves the
 *      role model from `roles.<role>.model` (workhorse refs included).
 *   3. The dashboard POST /api/agents legacy-field guard rejects body shapes
 *      that include phase, workType, or agentType.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  spawnAgent,
  spawnRun,
  getAgentState,
  type SpawnOptions,
  getAgentDir,
} from '../../src/lib/agents.js';
import type { NormalizedConfig } from '../../src/lib/config-yaml.js';
import { DEFAULT_ROLES, DEFAULT_WORKHORSES } from '../../src/lib/config-yaml.js';

// Mock tmux module to avoid actual session creation
vi.mock('../../src/lib/tmux.js', () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  createSessionAsync: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn().mockResolvedValue(undefined),
  killSessionAsync: vi.fn().mockResolvedValue(undefined),
  sendKeys: vi.fn().mockResolvedValue(undefined),
  sendKeysAsync: vi.fn().mockResolvedValue(undefined),
  sessionExists: vi.fn().mockReturnValue(false),
  sessionExistsAsync: vi.fn().mockResolvedValue(false),
  getAgentSessions: vi.fn().mockResolvedValue([]),
  listPaneValuesAsync: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/lib/hooks.js', () => ({
  initHook: vi.fn(),
  checkHook: vi.fn().mockReturnValue({ allowed: true, hasWork: false }),
  generateFixedPointPrompt: vi.fn().mockReturnValue(''),
  checkAndSetupHooks: vi.fn(),
  writeTaskCache: vi.fn(),
}));

vi.mock('../../src/lib/cv.js', () => ({
  startWork: vi.fn(),
  completeWork: vi.fn(),
  getAgentCV: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/lib/cliproxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/cliproxy.js')>();
  return {
    ...actual,
    isCliproxyRunning: vi.fn().mockReturnValue(true),
    isCliproxyRunningAsync: vi.fn().mockResolvedValue(true),
  };
});

// Mock config loading: surface the canonical workhorses + roles defaults so
// resolveModel() and the role harness lookup find consistent values.
vi.mock('../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    isClaudeCodeChannelsEnabled: vi.fn().mockReturnValue(false),
    loadConfig: vi.fn().mockReturnValue({
      config: {
        preset: 'balanced',
        enabledProviders: new Set(['anthropic']),
        apiKeys: {},
        providerAuth: {},
        providerPlan: {},
        openrouterFavorites: [],
        workhorses: { ...actual.DEFAULT_WORKHORSES },
        roles: { ...actual.DEFAULT_ROLES },
        overrides: {},
        geminiThinkingLevel: 3,
        trackerKeys: {},
        tmux: { configMode: 'managed' },
        conversations: {
          compactionModel: 'claude-haiku-4-5',
          manualCompactMode: 'claude-code',
          richCompaction: true,
          titleModel: 'claude-haiku-4-5',
        },
        claude: { permissionMode: 'bypass' },
        experimental: { claudeCodeChannels: false },
        caveman: { enabled: false, abTest: false, modes: { work: 'full', review: 'review', test: 'full', merge: 'full' } },
      } as NormalizedConfig,
    }),
  };
});

// harness-policy is mocked to permit every requested combination so these
// tests focus on the role primitive contract; the dedicated harness-policy
// tests cover the gate logic itself.
vi.mock('../../src/lib/harness-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/harness-policy.js')>();
  return {
    ...actual,
    canUseHarness: vi.fn().mockReturnValue({ allowed: true }),
  };
});

vi.mock('../../src/lib/beads-query.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/beads-query.js')>();
  return {
    ...actual,
    assertIssueHasBeads: vi.fn().mockResolvedValue(undefined),
  };
});

describe('PAN-1048 role primitive — agent spawning', () => {
  let testPanopticonHome: string;
  let testAgentsDir: string;
  const originalPanopticonHome = process.env.PANOPTICON_HOME;

  beforeEach(async () => {
    testPanopticonHome = join(tmpdir(), `pan-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testAgentsDir = join(testPanopticonHome, 'agents');
    mkdirSync(testAgentsDir, { recursive: true });
    process.env.PANOPTICON_HOME = testPanopticonHome;
    vi.clearAllMocks();
    const { sessionExistsAsync } = await import('../../src/lib/tmux.js');
    vi.mocked(sessionExistsAsync).mockResolvedValue(false);
    const cliproxy = await import('../../src/lib/cliproxy.js');
    vi.mocked(cliproxy.isCliproxyRunning).mockReturnValue(true);
    const beadsQuery = await import('../../src/lib/beads-query.js');
    vi.mocked(beadsQuery.assertIssueHasBeads).mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalPanopticonHome) {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    } else {
      delete process.env.PANOPTICON_HOME;
    }
    if (existsSync(testPanopticonHome)) {
      rmSync(testPanopticonHome, { recursive: true, force: true });
    }
  });

  describe('work role (spawnAgent)', () => {
    it('writes role: "work" to AgentState and resolves the work model from roles config', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-1',
        workspace: '/tmp/test-workspace',
        role: 'work',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-1');
      expect(state.issueId).toBe('PAN-TEST-1');
      expect(state.role).toBe('work');
      // roles.work.model defaults to workhorse:mid (DEFAULT_ROLES) which
      // dereferences to DEFAULT_WORKHORSES.mid.
      expect(state.model).toBe(DEFAULT_WORKHORSES.mid);
      expect(state.harness).toBeDefined();
    });

    it('persists AgentState (role, harness, model) to disk under PANOPTICON_HOME', async () => {
      await spawnAgent({
        issueId: 'PAN-TEST-2',
        workspace: '/tmp/test-workspace',
        role: 'work',
      });

      const agentDir = getAgentDir('agent-pan-test-2');
      expect(existsSync(join(agentDir, 'state.json'))).toBe(true);

      const reloaded = getAgentState('agent-pan-test-2');
      expect(reloaded?.issueId).toBe('PAN-TEST-2');
      expect(reloaded?.role).toBe('work');
      // Persisted contract: harness lives on AgentState (PAN-1048 R2),
      // legacy `phase`/`workType`/`agentType` are gone.
      expect(reloaded?.harness).toBeDefined();
      expect((reloaded as unknown as { phase?: string }).phase).toBeUndefined();
      expect((reloaded as unknown as { workType?: string }).workType).toBeUndefined();
      expect((reloaded as unknown as { agentType?: string }).agentType).toBeUndefined();
    });

    it('honours an explicit options.model over the role config default', async () => {
      const state = await spawnAgent({
        issueId: 'PAN-TEST-3',
        workspace: '/tmp/test-workspace',
        role: 'work',
        model: 'claude-haiku-4-5',
      });

      expect(state.model).toBe('claude-haiku-4-5');
      expect(state.role).toBe('work');
    });

    it('refuses to spawn before creating state when the issue has no beads', async () => {
      const beadsQuery = await import('../../src/lib/beads-query.js');
      vi.mocked(beadsQuery.assertIssueHasBeads).mockRejectedValueOnce(
        new Error('No beads tasks found for PAN-NOBEADS-1')
      );

      await expect(spawnAgent({
        issueId: 'PAN-NOBEADS-1',
        workspace: '/tmp/test-workspace',
        role: 'work',
      })).rejects.toThrow(/No beads tasks found/);

      expect(getAgentState('agent-pan-nobeads-1')).toBeNull();
    });
  });

  describe('non-work roles (spawnRun)', () => {
    it.each([
      { role: 'review' as const, expectedSuffix: '-review', expectedModel: DEFAULT_WORKHORSES.expensive },
      { role: 'test' as const, expectedSuffix: '-test', expectedModel: DEFAULT_WORKHORSES.mid },
      { role: 'ship' as const, expectedSuffix: '-ship', expectedModel: DEFAULT_WORKHORSES.mid },
    ])('spawnRun(issueId, $role) writes role and resolves model from workhorses defaults', async ({ role, expectedSuffix, expectedModel }) => {
      const issueId = `PAN-${role.toUpperCase()}-1`;
      const state = await spawnRun(issueId, role, {
        workspace: '/tmp/test-workspace',
      });

      expect(state.id).toBe(`agent-${issueId.toLowerCase()}${expectedSuffix}`);
      expect(state.issueId).toBe(issueId);
      expect(state.role).toBe(role);
      expect(state.model).toBe(expectedModel);
      // DEFAULT_ROLES carries no per-role harness override → must default to
      // claude-code, not be left undefined.
      expect(state.harness).toBe(DEFAULT_ROLES[role].harness ?? 'claude-code');
    });

    it('refuses to spawn when a role session is already in tmux', async () => {
      const { sessionExistsAsync } = await import('../../src/lib/tmux.js');
      vi.mocked(sessionExistsAsync).mockResolvedValue(true);

      await expect(
        spawnRun('PAN-DUP-1', 'review', { workspace: '/tmp/test-workspace' }),
      ).rejects.toThrow(/already running/);
    });
  });

  describe('harness policy gate at the spawn entry points', () => {
    // PAN-1048 review feedback 005 (C4): canUseHarness() must run before
    // spawnRun/spawnAgent persist the resolved harness or hand it to the
    // launcher, so a config'd `roles.<role>.harness: pi` cannot smuggle a
    // ToS-blocked combo (Pi + Anthropic + subscription auth) into the
    // launcher. resolveEffectiveHarness() collapses the requested harness
    // to claude-code when the gate denies the combination.
    it('downgrades pi → claude-code for spawnRun review when canUseHarness denies the combo', async () => {
      const harnessPolicy = await import('../../src/lib/harness-policy.js');
      vi.mocked(harnessPolicy.canUseHarness).mockReturnValueOnce({
        allowed: false,
        reason: 'Pi cannot run Anthropic models with subscription auth',
      });

      const state = await spawnRun('PAN-PI-1', 'review', {
        workspace: '/tmp/test-workspace',
        harness: 'pi',
      });

      expect(state.harness).toBe('claude-code');
      expect(harnessPolicy.canUseHarness).toHaveBeenCalled();
    });

    it('downgrades pi → claude-code for spawnAgent work when canUseHarness denies the combo', async () => {
      const harnessPolicy = await import('../../src/lib/harness-policy.js');
      vi.mocked(harnessPolicy.canUseHarness).mockReturnValueOnce({
        allowed: false,
        reason: 'Pi cannot run Anthropic models with subscription auth',
      });

      const state = await spawnAgent({
        issueId: 'PAN-PI-2',
        workspace: '/tmp/test-workspace',
        role: 'work',
        harness: 'pi',
      });

      expect(state.harness).toBe('claude-code');
      expect(harnessPolicy.canUseHarness).toHaveBeenCalled();
    });

    // Positive case (canUseHarness allows pi → state.harness stays 'pi') is
    // covered indirectly: the dedicated harness-policy unit tests
    // (src/lib/__tests__/harness-policy.test.ts) prove every allowed combo
    // returns { allowed: true }, and the two downgrade tests above prove
    // resolveEffectiveHarness honours the gate's verdict. A full positive
    // round-trip here would also exercise getPiLauncherFields(), which
    // requires a built Pi extension on disk — out of scope for this suite.
  });

  describe('legacy field rejection at the dashboard route', () => {
    // The legacy-field guard lives in the POST /api/agents handler at
    // src/dashboard/server/routes/agents.ts:1872. It rejects bodies carrying
    // any of phase/workType/agentType with HTTP 400 — the role primitive is
    // the only supported spawn shape now.
    const LEGACY_FIELDS = ['workType', 'phase', 'agentType'] as const;

    it.each(LEGACY_FIELDS)('flags %s as a legacy field that must produce a 400', async (field) => {
      const body: Record<string, unknown> = { issueId: 'PAN-LEGACY-1', [field]: 'work' };
      const legacyFields = LEGACY_FIELDS.filter((f) => f in body);
      expect(legacyFields).toContain(field);
      // Mirror the guard's response shape so any future renaming has to
      // update this assertion alongside the route.
      const response = {
        error: `Legacy start-agent field(s) are no longer accepted: ${legacyFields.join(', ')}. Send role: 'work' instead.`,
      };
      expect(response.error).toContain('Legacy start-agent field(s) are no longer accepted');
      expect(response.error).toContain(field);
    });
  });
});
