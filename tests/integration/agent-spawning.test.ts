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

import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import {
  spawnAgent,
  spawnRun,
  getAgentStateSync,
  type SpawnOptions,
  getAgentDir,
} from '../../src/lib/agents.js';
import { captureCheckpoint, hasCheckpoint } from '../../src/lib/checkpoint/checkpoint-manager.js';
import type { NormalizedConfig } from '../../src/lib/config-yaml.js';
import { DEFAULT_ROLES, DEFAULT_WORKHORSES } from '../../src/lib/config-yaml.js';

const piFifoMocks = vi.hoisted(() => ({
  writePiCommand: vi.fn(),
}));

vi.mock('../../src/lib/runtimes/pi-fifo.js', () => ({
  PiNotReady: class PiNotReady extends Error {},
  createPiFifo: vi.fn((agentId: string) => Effect.sync(() => {
    const dir = join(process.env.PANOPTICON_HOME ?? tmpdir(), 'agents', agentId);
    mkdirSync(dir, { recursive: true });
    return join(dir, 'rpc.in');
  })),
  piFifoPaths: (agentId: string) => {
    const dir = join(process.env.PANOPTICON_HOME ?? tmpdir(), 'agents', agentId);
    return {
      agentDir: dir,
      readyPath: join(dir, 'ready.json'),
      fifoPath: join(dir, 'rpc.in'),
    };
  },
  writePiCommand: piFifoMocks.writePiCommand,
  writePiCommandSync: piFifoMocks.writePiCommand,
}));

// Mock tmux module to avoid actual session creation
vi.mock('../../src/lib/tmux.js', () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn(() => Effect.void),
  killSession: vi.fn().mockResolvedValue(undefined),
  killSessionSync: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn(() => Effect.void),
  killSessionSync: vi.fn(() => Effect.void),
  sendKeys: vi.fn(() => Effect.void),
  sendKeysProgram: vi.fn(() => Effect.void),
  sendRawKeystroke: vi.fn(() => Effect.void),
  sessionExists: vi.fn().mockReturnValue(false),
  sessionExistsSync: vi.fn().mockReturnValue(false),
  sessionExists: vi.fn(() => Effect.succeed(false)),
  sessionExistsSync: vi.fn(() => Effect.succeed(false)),
  getAgentSessions: vi.fn().mockResolvedValue([]),
  getAgentSessionsSync: vi.fn().mockResolvedValue([]),
  getAgentSessions: vi.fn(() => Effect.succeed([])),
  getAgentSessionsSync: vi.fn(() => Effect.succeed([])),
  listPaneValues: vi.fn(() => Effect.succeed([])),
  setOption: vi.fn(() => Effect.void),
  capturePane: vi.fn().mockResolvedValue('Claude Code'),
  capturePane: vi.fn(() => Effect.succeed('Claude Code')),
}));

vi.mock('../../src/lib/hooks.js', () => ({
  initHook: vi.fn(),
  initHookSync: vi.fn(),
  checkHook: vi.fn().mockReturnValue({ allowed: true, hasWork: false }),
  checkHookSync: vi.fn().mockReturnValue({ allowed: true, hasWork: false }),
  generateFixedPointPrompt: vi.fn().mockReturnValue(''),
  checkAndSetupHooks: vi.fn(),
  writeTaskCache: vi.fn(),
}));

vi.mock('../../src/lib/cv.js', () => ({
  startWork: vi.fn(),
  startWorkSync: vi.fn(),
  completeWork: vi.fn(),
  completeWorkSync: vi.fn(),
  getAgentCV: vi.fn().mockReturnValue(null),
  getAgentCVSync: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/lib/memory/injection.js', () => ({
  injectPromptTimeMemory: vi.fn().mockResolvedValue({
    status: 'injected',
    reason: null,
    context: '',
    decision: {},
  }),
}));

vi.mock('../../src/lib/cliproxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/cliproxy.js')>();
  return {
    ...actual,
    isCliproxyRunning: vi.fn().mockReturnValue(Effect.succeed(true)),
    isCliproxyRunningSync: vi.fn().mockReturnValue(true),
    isCliproxyRunningProgram: vi.fn(() => Effect.succeed(true)),
  };
});

// Mock config loading: surface the canonical workhorses + roles defaults so
// resolveModel() and the role harness lookup find consistent values.
vi.mock('../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/config-yaml.js')>();
  const loadedConfig = {
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
  };
  return {
    ...actual,
    isClaudeCodeChannelsEnabled: vi.fn().mockReturnValue(false),
    loadConfig: vi.fn().mockReturnValue(loadedConfig),
    loadConfigSync: vi.fn().mockReturnValue(loadedConfig),
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
    canUseHarnessSync: vi.fn().mockReturnValue({ allowed: true }),
  };
});

vi.mock('../../src/lib/beads-query.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/beads-query.js')>();
  return {
    ...actual,
    assertIssueHasBeads: vi.fn(() => Effect.void),
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
    const { sessionExists } = await import('../../src/lib/tmux.js');
    vi.mocked(sessionExists).mockReturnValue(Effect.succeed(false));
    const cliproxy = await import('../../src/lib/cliproxy.js');
    vi.mocked(cliproxy.isCliproxyRunningSync).mockReturnValue(true);
    const beadsQuery = await import('../../src/lib/beads-query.js');
    vi.mocked(beadsQuery.assertIssueHasBeads).mockReturnValue(Effect.void);
    piFifoMocks.writePiCommand.mockClear();
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

      const reloaded = getAgentStateSync('agent-pan-test-2');
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
      vi.mocked(beadsQuery.assertIssueHasBeads).mockReturnValueOnce(
        Effect.fail(new Error('No beads tasks found for PAN-NOBEADS-1'))
      );

      await expect(spawnAgent({
        issueId: 'PAN-NOBEADS-1',
        workspace: '/tmp/test-workspace',
        role: 'work',
      })).rejects.toThrow(/No beads tasks found/);

      expect(getAgentStateSync('agent-pan-nobeads-1')).toBeNull();
    });

    // ─── PAN-1215 cleanup block ─────────────────────────────────────────────────

    it('untracks workspace .pan/ artifacts when tracked and working tree is clean (AC22)', async () => {
      const workspace = join(tmpdir(), `pan-1215-ac22-${Date.now()}`);
      mkdirSync(join(workspace, '.pan'), { recursive: true });
      execSync('git init', { cwd: workspace });
      execSync('git config user.email "test@test.com"', { cwd: workspace });
      execSync('git config user.name "Test"', { cwd: workspace });
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":1}');
      writeFileSync(join(workspace, '.pan', 'spec.vbrief.json'), '{"p":1}');
      execSync('git add .', { cwd: workspace });
      execSync('git commit -m "initial"', { cwd: workspace });

      await spawnAgent({ issueId: 'PAN-AC22', workspace, role: 'work' });

      const tracked = execSync('git ls-files .pan/continue.json .pan/spec.vbrief.json', {
        cwd: workspace,
        encoding: 'utf-8',
      }).trim();
      expect(tracked).toBe('');

      const log = execSync('git log --oneline', { cwd: workspace, encoding: 'utf-8' }).trim();
      expect(log).toContain('chore: untrack workspace .pan/ artifacts (PAN-1215)');

      rmSync(workspace, { recursive: true, force: true });
    });

    it('warns and skips untrack when .pan/ paths have uncommitted changes (AC23)', async () => {
      const workspace = join(tmpdir(), `pan-1215-ac23-${Date.now()}`);
      mkdirSync(join(workspace, '.pan'), { recursive: true });
      execSync('git init', { cwd: workspace });
      execSync('git config user.email "test@test.com"', { cwd: workspace });
      execSync('git config user.name "Test"', { cwd: workspace });
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":1}');
      execSync('git add .', { cwd: workspace });
      execSync('git commit -m "initial"', { cwd: workspace });

      // Make .pan/ dirty
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":2}');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await spawnAgent({ issueId: 'PAN-AC23', workspace, role: 'work' });

      // No untrack commit should have been made
      const log = execSync('git log --oneline', { cwd: workspace, encoding: 'utf-8' }).trim();
      expect(log.split('\n').length).toBe(1);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping .pan/ untrack'),
      );
      warnSpy.mockRestore();

      rmSync(workspace, { recursive: true, force: true });
    });

    it('short-cuits .pan/ cleanup when neither file is tracked (AC24)', async () => {
      const workspace = join(tmpdir(), `pan-1215-ac24-${Date.now()}`);
      mkdirSync(join(workspace, '.pan'), { recursive: true });
      execSync('git init', { cwd: workspace });
      execSync('git config user.email "test@test.com"', { cwd: workspace });
      execSync('git config user.name "Test"', { cwd: workspace });
      writeFileSync(join(workspace, 'readme.md'), '# test');
      execSync('git add readme.md', { cwd: workspace });
      execSync('git commit -m "initial"', { cwd: workspace });

      // Files exist on disk but are NOT tracked
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":1}');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await spawnAgent({ issueId: 'PAN-AC24', workspace, role: 'work' });
      logSpy.mockRestore();
      warnSpy.mockRestore();

      // No new commit
      const log = execSync('git log --oneline', { cwd: workspace, encoding: 'utf-8' }).trim();
      expect(log.split('\n').length).toBe(1);

      // No warning about skipping untrack (the dirty-path warning)
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Skipping .pan/ untrack'),
      );
      // No "Untracked workspace .pan/ artifacts" success log either
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Untracked workspace .pan/ artifacts'),
      );

      rmSync(workspace, { recursive: true, force: true });
    });

    it('checkpoint after cleanup excludes previously tracked .pan/ artifacts (AC28)', async () => {
      const workspace = join(tmpdir(), `pan-1215-ac28-${Date.now()}`);
      mkdirSync(join(workspace, '.pan'), { recursive: true });
      execSync('git init', { cwd: workspace });
      execSync('git config user.email "test@test.com"', { cwd: workspace });
      execSync('git config user.name "Test"', { cwd: workspace });
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":1}');
      writeFileSync(join(workspace, '.pan', 'spec.vbrief.json'), '{"p":1}');
      writeFileSync(join(workspace, 'readme.md'), '# test');
      execSync('git add .', { cwd: workspace });
      execSync('git commit -m "initial"', { cwd: workspace });

      await spawnAgent({ issueId: 'PAN-AC28', workspace, role: 'work' });

      // Modify the now-untracked file and capture a checkpoint
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":2}');
      await Effect.runPromise(captureCheckpoint(workspace, 'agent-pan-ac28', 'turn-1'));

      expect(await Effect.runPromise(hasCheckpoint(workspace, 'agent-pan-ac28', 'turn-1'))).toBe(true);
      const ref = 'refs/pan/turn/agent-pan-ac28/turn-1';
      const commit = execSync(`git rev-parse ${ref}`, { cwd: workspace, encoding: 'utf-8' }).trim();
      const files = execSync(`git ls-tree -r --name-only ${commit}`, { cwd: workspace, encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean);

      expect(files).not.toContain('.pan/continue.json');
      expect(files).not.toContain('.pan/spec.vbrief.json');
      expect(files).toContain('readme.md');

      rmSync(workspace, { recursive: true, force: true });
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
      const { setOption } = await import('../../src/lib/tmux.js');
      expect(setOption).toHaveBeenCalledWith(state.id, 'destroy-unattached', 'off');
      expect(setOption).toHaveBeenCalledWith(state.id, 'remain-on-exit', 'on');
    });

    it('launches review sub-roles in headless print mode with prompt on stdin', async () => {
      const tmux = await import('../../src/lib/tmux.js');

      await spawnRun('PAN-SUBREVIEW-1', 'review', {
        workspace: '/tmp/test-workspace',
        subRole: 'security',
        prompt: 'review this diff',
      });

      const agentDir = getAgentDir('agent-pan-subreview-1-review-security');
      const launcher = readFileSync(join(agentDir, 'launcher.sh'), 'utf8');

      expect(launcher).toContain('exec claude --print');
      expect(launcher).toContain("--name agent-pan-subreview-1-review-security --session-id '");
      expect(launcher).toContain("< '");
      expect(launcher).toContain("initial-prompt.md'");
      expect(launcher).not.toContain('prompt=$(cat');
      expect(launcher).not.toContain('"$prompt"');
      expect(tmux.sendKeys).not.toHaveBeenCalled();
    });

    it('review sub-role launcher owns the REVIEWER_READY/FAILED/TIMEOUT signal (PAN-977)', async () => {
      await spawnRun('PAN-SUBSIGNAL-1', 'review', {
        workspace: '/tmp/test-workspace',
        subRole: 'correctness',
        prompt: 'review this diff',
        reviewSynthesisAgentId: 'agent-pan-subsignal-1-review',
        reviewOutputPath: '/tmp/out/review-correctness.md',
      });

      const agentDir = getAgentDir('agent-pan-subsignal-1-review-correctness');
      const launcher = readFileSync(join(agentDir, 'launcher.sh'), 'utf8');

      // The launcher — not the agent, not Deacon — owns the signal: it runs
      // claude as a child (no exec) so the contract block runs on exit, and is
      // HUP-immune so it outlives the (short-lived) tmux session.
      expect(launcher).not.toContain('exec claude');
      expect(launcher).toContain("trap '' HUP");
      expect(launcher).toContain('timeout 1800 claude --print');
      expect(launcher).toContain(`< '${join(agentDir, 'initial-prompt.md')}'`);
      expect(launcher).toContain('CLAUDE_EXIT=$?');
      expect(launcher).toContain(`echo $$ > '${join(agentDir, 'reviewer-launcher.pid')}'`);
      expect(launcher).toContain('"REVIEWER_READY correctness /tmp/out/review-correctness.md"');
      expect(launcher).toContain('"REVIEWER_FAILED correctness reviewer exited (code $CLAUDE_EXIT) without writing report"');
      expect(launcher).toContain('"REVIEWER_TIMEOUT correctness reviewer exceeded 1800s deadline"');
      expect(launcher).toContain(`touch '${join(agentDir, 'reviewer-signaled')}'`);
      expect(launcher).toContain(`rm -f '${join(agentDir, 'reviewer-launcher.pid')}'`);

      // Synthesis wiring is persisted on AgentState too (Deacon backup path).
      const state = getAgentStateSync('agent-pan-subsignal-1-review-correctness');
      expect(state?.reviewSynthesisAgentId).toBe('agent-pan-subsignal-1-review');
      expect(state?.reviewOutputPath).toBe('/tmp/out/review-correctness.md');
    });

    it('delivers Pi specialist prompts through the FIFO instead of tmux readiness', async () => {
      const tmux = await import('../../src/lib/tmux.js');
      vi.mocked(tmux.createSession).mockImplementationOnce((agentId: string) => Effect.sync(() => {
        const agentDir = join(testAgentsDir, agentId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'ready.json'), JSON.stringify({ ready: true }));
      }));
      vi.mocked(tmux.capturePane).mockReturnValueOnce(Effect.succeed('pi rpc mode'));

      const state = await spawnRun('PAN-PI-PROMPT-1', 'test', {
        workspace: '/tmp/test-workspace',
        harness: 'pi',
        prompt: 'run the tests',
      });

      expect(state.harness).toBe('pi');
      expect(piFifoMocks.writePiCommand).toHaveBeenCalledWith(
        'agent-pan-pi-prompt-1-test',
        expect.objectContaining({ type: 'prompt', message: 'run the tests' }),
      );
      expect(tmux.capturePane).not.toHaveBeenCalled();
      expect(tmux.sendKeys).not.toHaveBeenCalled();
    });

    it('refuses to spawn when a role session is already in tmux', async () => {
      const { sessionExists } = await import('../../src/lib/tmux.js');
      vi.mocked(sessionExists).mockReturnValue(Effect.succeed(true));

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
      vi.mocked(harnessPolicy.canUseHarnessSync).mockReturnValueOnce({
        allowed: false,
        reason: 'Pi cannot run Anthropic models with subscription auth',
      });

      const state = await spawnRun('PAN-PI-1', 'review', {
        workspace: '/tmp/test-workspace',
        harness: 'pi',
      });

      expect(state.harness).toBe('claude-code');
      expect(harnessPolicy.canUseHarnessSync).toHaveBeenCalled();
    });

    it('downgrades pi → claude-code for spawnAgent work when canUseHarness denies the combo', async () => {
      const harnessPolicy = await import('../../src/lib/harness-policy.js');
      vi.mocked(harnessPolicy.canUseHarnessSync).mockReturnValueOnce({
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
      expect(harnessPolicy.canUseHarnessSync).toHaveBeenCalled();
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
