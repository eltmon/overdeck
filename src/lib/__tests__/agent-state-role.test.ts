import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { AgentState } from '../agents.js';

let tempHome: string;

describe('AgentState role persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    tempHome = mkdtempSync(join(tmpdir(), 'pan-agent-role-'));
    process.env.PANOPTICON_HOME = tempHome;
  });

  afterEach(() => {
    vi.doUnmock('../config-yaml.js');
    vi.doUnmock('../tmux.js');
    vi.doUnmock('../workspace/stack-health.js');
    vi.doUnmock('../beads-query.js');
    vi.doUnmock('../activity-logger.js');
    vi.doUnmock('../cloister/work-agent-prompt.js');
    vi.doUnmock('../projects.js');
    delete process.env.PANOPTICON_HOME;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('resolves the work role model through role config defaults', async () => {
    vi.doMock('../config-yaml.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../config-yaml.js')>();
      return {
        ...actual,
        loadConfig: () => ({
          config: {
            workhorses: actual.DEFAULT_WORKHORSES,
            roles: actual.DEFAULT_ROLES,
          },
        }),
      };
    });
    const { determineModel } = await import('../agents.js');

    // PAN-1048 R4: default workhorse:mid is claude-sonnet-4-6.
    expect(determineModel({ role: 'work' })).toBe('claude-sonnet-4-6');
    expect(determineModel({ role: 'work', model: 'claude-opus-4-7' })).toBe('claude-opus-4-7');
  });

  it('builds review role runtime commands from roles/review.md', async () => {
    const { getRoleRuntimeBaseCommand, roleAgentDefinitionPath, spawnRun } = await import('../agents.js');

    expect(roleAgentDefinitionPath('review')).toBe('roles/review.md');
    expect(spawnRun).toEqual(expect.any(Function));

    const command = await getRoleRuntimeBaseCommand('claude-opus-4-7', 'agent-pan-1048-review', 'review');
    expect(command).toContain('--agent roles/review.md');
    expect(command).toContain("--model 'claude-opus-4-7'");
    expect(command).toContain('--name agent-pan-1048-review');
    expect(command).not.toContain('pan-review-agent');
  });

  it('threads configured effort into claude-code role runtime commands', async () => {
    const { getRoleRuntimeBaseCommand } = await import('../agents.js');

    const command = await getRoleRuntimeBaseCommand('claude-opus-4-7', 'flywheel-orchestrator', 'flywheel', 'claude-code', undefined, 'low');
    expect(command).toContain('--agent roles/flywheel.md');
    expect(command).toContain("--model 'claude-opus-4-7'");
    expect(command).toContain('--effort low');
  });

  it('preserves the flywheel singleton agent id during normalization', async () => {
    const { normalizeAgentId } = await import('../agents.js');

    expect(normalizeAgentId('flywheel-orchestrator')).toBe('flywheel-orchestrator');
    expect(normalizeAgentId('PAN-1')).toBe('agent-pan-1');
  });

  it('does not pass --agent for review convoy sub-roles (prompts are harness-agnostic templates inlined by the orchestrator)', async () => {
    const { getRoleRuntimeBaseCommand, roleAgentDefinitionPath } = await import('../agents.js');

    for (const subRole of ['security', 'correctness', 'performance', 'requirements'] as const) {
      expect(roleAgentDefinitionPath('review', subRole)).toBeNull();

      const command = await getRoleRuntimeBaseCommand(
        'claude-sonnet-4-6',
        `agent-pan-1059-review-${subRole}`,
        'review',
        'claude-code',
        subRole,
      );
      expect(command).not.toContain('--agent');
      expect(command).not.toContain('.claude/agents');
      expect(command).toContain("--model 'claude-sonnet-4-6'");
      expect(command).toContain(`--name agent-pan-1059-review-${subRole}`);
    }
  });

  it('requires role and strips legacy state fields when persisting state.json', async () => {
    const { getAgentState, saveAgentState } = await import('../agents.js');

    saveAgentState({
      id: 'agent-pan-role',
      issueId: 'PAN-1048',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: '2026-05-09T00:00:00.000Z',
      runtime: 'claude-code',
      phase: 'implementation',
      workType: 'feature',
      complexity: 'M',
      handoffCount: 3,
      agentPhase: 'implementation',
      type: 'work',
    } as any);

    const state = getAgentState('agent-pan-role');
    expect(state?.role).toBe('work');
    expect((state as any).runtime).toBeUndefined();
    expect((state as any).phase).toBeUndefined();

    const rawState = JSON.parse(readFileSync(join(tempHome, 'agents', 'agent-pan-role', 'state.json'), 'utf-8'));
    expect(rawState.role).toBe('work');
    expect(rawState.harness).toBe('claude-code');
    expect(rawState.runtime).toBeUndefined();
    expect(rawState.phase).toBeUndefined();
    expect(rawState.workType).toBeUndefined();
    expect(rawState.complexity).toBeUndefined();
    expect(rawState.handoffCount).toBeUndefined();
    expect(rawState.agentPhase).toBeUndefined();
    expect(rawState.type).toBeUndefined();
  });

  it('accepts flywheel role in persisted state.json', async () => {
    const { getAgentState, saveAgentState } = await import('../agents.js');

    saveAgentState({
      id: 'agent-flywheel-orchestrator',
      issueId: 'RUN-1',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'flywheel',
      model: 'claude-opus-4-7',
      status: 'running',
      startedAt: '2026-05-18T00:00:00.000Z',
    } as any);

    expect(getAgentState('agent-flywheel-orchestrator')?.role).toBe('flywheel');
  });

  it('bases Channels eligibility on work role and claude-code harness', async () => {
    vi.doMock('../config-yaml.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../config-yaml.js')),
      isClaudeCodeChannelsEnabled: () => true,
    }));
    const { decideChannelsForWorkAgent } = await import('../agents.js');

    const state: AgentState = {
      id: 'agent-pan-channels',
      issueId: 'PAN-1048',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'starting',
      startedAt: '2026-05-09T00:00:00.000Z',
    };

    expect(decideChannelsForWorkAgent('agent-pan-channels', {} as any, { ...state, role: 'review' })).toEqual({
      eligible: false,
      reason: 'not-a-work-agent',
    });
    expect(decideChannelsForWorkAgent('agent-pan-channels', {} as any, { ...state, harness: 'pi' })).toEqual({
      eligible: false,
      reason: 'harness-pi',
    });
  });

  it('blocks spawnAgent from cached stack health before side effects', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-stack-cache-gate-'));
    const createSessionAsync = vi.fn();
    const emitActivityEntry = vi.fn();
    vi.doMock('../projects.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../projects.js')),
      resolveProjectFromIssue: vi.fn(() => ({
        projectKey: 'panopticon',
        projectName: 'Panopticon',
        projectPath: workspace,
        linearTeam: 'PAN',
      })),
      getProject: vi.fn(() => ({ workspace: { docker: { compose_template: 'infra/.devcontainer-template' } } })),
    }));
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      sessionExistsAsyncEffect: vi.fn(() => Effect.succeed(false)),
      createSessionAsyncEffect: vi.fn((...args: unknown[]) => Effect.promise(() => Promise.resolve(createSessionAsync(...args)))),
    }));
    vi.doMock('../beads-query.js', () => ({ assertIssueHasBeads: vi.fn(async () => undefined) }));
    vi.doMock('../activity-logger.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../activity-logger.js')),
      emitActivityEntry,
    }));
    const { recordDockerContainerLifecycleSnapshot } = await import('../docker-stats.js');
    recordDockerContainerLifecycleSnapshot([{
      id: 'abc123',
      name: 'panopticon-feature-pan-1140-init-1',
      status: 'Exited (1) 5 minutes ago',
      state: 'exited',
      createdAt: '2026-05-16T00:00:00.000Z',
    }], '2026-05-16T00:00:00.000Z');

    const { spawnAgent } = await import('../agents.js');

    await expect(spawnAgent({
      issueId: 'PAN-1140',
      workspace,
      role: 'work',
      model: 'claude-sonnet-4-6',
    })).rejects.toThrow("Workspace docker stack for PAN-1140 is not healthy: panopticon-feature-pan-1140-init-1 init exited non-zero (1). Run 'pan workspace rebuild PAN-1140' or retry with --host to override.");

    expect(createSessionAsync).not.toHaveBeenCalled();
    expect(emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      issueId: 'PAN-1140',
      message: 'agent-spawn-blocked-stack-unhealthy: PAN-1140',
    }));
    rmSync(workspace, { recursive: true, force: true });
  });

  it('blocks spawnAgent before side effects when the workspace stack is unhealthy', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-stack-gate-'));
    const createSessionAsync = vi.fn();
    const emitActivityEntry = vi.fn();
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({
        healthy: false,
        reasons: ['panopticon-feature-pan-1140-init init exited non-zero (1)'],
        lastObserved: '2026-05-16T00:00:00.000Z',
      })),
    }));
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      sessionExistsAsyncEffect: vi.fn(() => Effect.succeed(false)),
      createSessionAsyncEffect: vi.fn((...args: unknown[]) => Effect.promise(() => Promise.resolve(createSessionAsync(...args)))),
    }));
    vi.doMock('../beads-query.js', () => ({ assertIssueHasBeads: vi.fn(async () => undefined) }));
    vi.doMock('../activity-logger.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../activity-logger.js')),
      emitActivityEntry,
    }));

    const { spawnAgent } = await import('../agents.js');

    await expect(spawnAgent({
      issueId: 'PAN-1140',
      workspace,
      role: 'work',
      model: 'claude-sonnet-4-6',
    })).rejects.toThrow("Workspace docker stack for PAN-1140 is not healthy: panopticon-feature-pan-1140-init init exited non-zero (1). Run 'pan workspace rebuild PAN-1140' or retry with --host to override.");

    expect(createSessionAsync).not.toHaveBeenCalled();
    expect(emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      issueId: 'PAN-1140',
      message: 'agent-spawn-blocked-stack-unhealthy: PAN-1140',
    }));
    rmSync(workspace, { recursive: true, force: true });
  });

  it('allows explicit host override when the workspace stack is unhealthy', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-stack-host-'));
    const createSessionAsync = vi.fn(async () => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const emitActivityEntry = vi.fn();
    vi.doMock('../config-yaml.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../config-yaml.js')),
      isClaudeCodeChannelsEnabled: () => false,
    }));
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({
        healthy: false,
        reasons: ['panopticon-feature-pan-1140-server stuck Created for 180s'],
        lastObserved: '2026-05-16T00:00:00.000Z',
      })),
    }));
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      sessionExistsAsyncEffect: vi.fn(() => Effect.succeed(false)),
      sessionExists: vi.fn(() => false),
      createSessionAsyncEffect: vi.fn((...args: unknown[]) => Effect.promise(() => Promise.resolve(createSessionAsync(...args)))),
      capturePaneAsyncEffect: vi.fn(() => Effect.succeed('Claude Code')),
      setOptionAsyncEffect: vi.fn(() => Effect.void),
    }));
    vi.doMock('../beads-query.js', () => ({ assertIssueHasBeads: vi.fn(async () => undefined) }));
    vi.doMock('../activity-logger.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../activity-logger.js')),
      emitActivityEntry,
      emitActivityTts: vi.fn(),
    }));
    vi.doMock('../cloister/work-agent-prompt.js', () => ({
      writeStoryFeatureContext: vi.fn(async () => undefined),
    }));

    const { spawnAgent } = await import('../agents.js');

    const state = await spawnAgent({
      issueId: 'PAN-1140',
      workspace,
      role: 'work',
      model: 'claude-sonnet-4-6',
      allowHost: true,
    });

    expect(state.hostOverride).toBe(true);
    expect(createSessionAsync).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('retry with --host to override'));
    expect(emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      issueId: 'PAN-1140',
      message: 'agent-spawn-host-override: PAN-1140',
    }));
    warnSpy.mockRestore();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('does not block when workspace stack health is healthy', async () => {
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: '2026-05-16T00:00:00.000Z' })),
    }));
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');

    await expect(assertWorkspaceStackHealthyForSpawn('MIN-1', 'work')).resolves.toBeUndefined();
  });

  it('treats state.json without a valid role as missing', async () => {
    const { getAgentState } = await import('../agents.js');
    const dir = join(tempHome, 'agents', 'agent-pan-legacy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      id: 'agent-pan-legacy',
      issueId: 'PAN-1048',
      workspace: '/tmp/workspace',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: '2026-05-09T00:00:00.000Z',
    }));

    const state = getAgentState('agent-pan-legacy');
    expect(state).toBeNull();
  });

  it('drops legacy agent state directories missing role during startup scan', async () => {
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      killSession: vi.fn(),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { warnOnBareNumericIssueIds } = await import('../agents.js');

    const legacyDir = join(tempHome, 'agents', 'agent-pan-legacy');
    const validDir = join(tempHome, 'agents', 'agent-pan-valid');
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(validDir, { recursive: true });
    writeFileSync(join(legacyDir, 'state.json'), JSON.stringify({
      id: 'agent-pan-legacy',
      issueId: 'PAN-1048',
      workspace: '/tmp/workspace',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: '2026-05-09T00:00:00.000Z',
    }));
    writeFileSync(join(validDir, 'state.json'), JSON.stringify({
      id: 'agent-pan-valid',
      issueId: 'PAN-1048',
      workspace: '/tmp/workspace',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: '2026-05-09T00:00:00.000Z',
    }));

    await warnOnBareNumericIssueIds();

    expect(existsSync(legacyDir)).toBe(false);
    expect(existsSync(validDir)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith('[agents] Dropped 1 legacy agent state file(s) missing role');
    warnSpy.mockRestore();
  });
});
