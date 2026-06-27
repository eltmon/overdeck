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
    process.env.OVERDECK_HOME = tempHome;
  });

  afterEach(() => {
    vi.doUnmock('../config-yaml.js');
    vi.doUnmock('../tmux.js');
    vi.doUnmock('../workspace/stack-health.js');
    vi.doUnmock('../workspace/rebuild-stack.js');
    vi.doUnmock('../beads-query.js');
    vi.doUnmock('../activity-logger.js');
    vi.doUnmock('../cloister/work-agent-prompt.js');
    vi.doUnmock('../projects.js');
    vi.doUnmock('../agents.js');
    vi.doUnmock('../cloister/agent-idle.js');
    vi.doUnmock('../cloister/issue-closed.js');
    vi.doUnmock('../cloister/specialists.js');
    vi.doUnmock('../transcript-landing.js');
    vi.doUnmock('../agent-runtime-mirror.js');
    vi.doUnmock('../runtimes/pi-fifo.js');
    vi.doUnmock('../runtimes/ohmypi-fifo.js');
    vi.doUnmock('../harness-resolve.js');
    delete process.env.OVERDECK_HOME;
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
        loadConfigSync: () => ({
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
    // PAN-2087: role FILES are injected as a system prompt (Claude Code 2.1.195
    // dropped --agent file support), not passed to --agent.
    expect(command).not.toContain('--agent ');
    expect(command).toMatch(/--append-system-prompt-file '[^']*role-prompts\/review\.md'/);
    expect(command).toContain("--model 'claude-opus-4-7'");
    expect(command).toContain('--name agent-pan-1048-review');
    expect(command).not.toContain('pan-review-agent');
  });

  it('threads configured effort into claude-code role runtime commands', async () => {
    const { getRoleRuntimeBaseCommand } = await import('../agents.js');

    const command = await getRoleRuntimeBaseCommand('claude-opus-4-7', 'flywheel-orchestrator', 'flywheel', 'claude-code', undefined, 'low');
    expect(command).not.toContain('--agent ');
    expect(command).toMatch(/--append-system-prompt-file '[^']*role-prompts\/flywheel\.md'/);
    expect(command).toContain("--model 'claude-opus-4-7'");
    expect(command).toContain('--effort low');
  });

  it('PAN-2090: review role reconstitutes its tools: allow-list via --allowedTools (no MCP)', async () => {
    const { getRoleRuntimeBaseCommand } = await import('../agents.js');
    const command = await getRoleRuntimeBaseCommand('claude-opus-4-7', 'agent-pan-1-review', 'review');
    expect(command).toContain("--allowedTools 'Read,Grep,Glob,Bash'");
    expect(command).not.toContain('--mcp-config'); // review.md declares no mcpServers
  });

  it('PAN-2090: test role reconstitutes mcpServers via --mcp-config and keeps playwright in --allowedTools', async () => {
    const { getRoleRuntimeBaseCommand } = await import('../agents.js');
    const command = await getRoleRuntimeBaseCommand('claude-opus-4-7', 'agent-pan-1-test', 'test');
    // playwright MCP wired, AND included in the allow-list so the strict list does not block it.
    expect(command).toMatch(/--mcp-config '[^']*role-prompts\/test\.mcp\.json'/);
    expect(command).toMatch(/--allowedTools 'Read,Grep,Glob,Bash,mcp__playwright'/);
    // the generated config is valid JSON declaring the playwright stdio server.
    const m = command.match(/--mcp-config '([^']*)'/);
    const cfg = JSON.parse(readFileSync(m![1], 'utf-8'));
    expect(cfg.mcpServers.playwright).toMatchObject({ command: 'npx' });
  });

  it('preserves first-class runtime session ids during normalization', async () => {
    const { normalizeAgentId } = await import('../agents.js');

    expect(normalizeAgentId('flywheel-orchestrator')).toBe('flywheel-orchestrator');
    expect(normalizeAgentId('inspect-pan-1613-workspace-rn3ha')).toBe('inspect-pan-1613-workspace-rn3ha');
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
    const { getAgentStateSync, saveAgentStateSync } = await import('../agents.js');

    saveAgentStateSync({
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

    const state = getAgentStateSync('agent-pan-role');
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

  it('persists lastResumeAt through normal state save and load', async () => {
    const { getAgentStateSync, saveAgentStateSync } = await import('../agents.js');
    const lastResumeAt = '2026-06-10T00:01:00.000Z';

    saveAgentStateSync({
      id: 'agent-pan-resume-state',
      issueId: 'PAN-1700',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: '2026-06-10T00:00:00.000Z',
      lastResumeAt,
    } as any);

    expect(getAgentStateSync('agent-pan-resume-state')?.lastResumeAt).toBe(lastResumeAt);
    const rawState = JSON.parse(readFileSync(join(tempHome, 'agents', 'agent-pan-resume-state', 'state.json'), 'utf-8'));
    expect(rawState.lastResumeAt).toBe(lastResumeAt);
  });

  it('lets the stalled-resume patrol observe a persisted lastResumeAt from disk', async () => {
    const messageAgent = vi.fn(async () => undefined);
    vi.doMock('../tmux.js', async () => ({
      createSessionSync: vi.fn(),
      createSession: vi.fn(() => Effect.void),
      killSessionSync: vi.fn(),
      killSession: vi.fn(() => Effect.void),
      sendKeys: vi.fn(() => Effect.void),
      sendKeysProgram: vi.fn(() => Effect.void),
      sendRawKeystroke: vi.fn(() => Effect.void),
      sessionExistsSync: vi.fn(() => true),
      sessionExists: vi.fn(() => Effect.succeed(true)),
      listSessions: vi.fn(() => Effect.succeed([])),
      listSessionsSync: vi.fn(() => []),
      listSessionNames: vi.fn(() => Effect.succeed([])),
      capturePaneSync: vi.fn(() => ''),
      capturePane: vi.fn(() => Effect.succeed('')),
      listPaneValuesSync: vi.fn(() => []),
      listPaneValues: vi.fn(() => Effect.succeed([])),
      setOption: vi.fn(() => Effect.void),
      buildTmuxCommandString: vi.fn(() => 'tmux'),
      isPaneDead: vi.fn(() => false),
    }));
    vi.doMock('../cloister/agent-idle.js', () => ({
      isAgentIdleForNudge: vi.fn(() => true),
    }));
    vi.doMock('../cloister/issue-closed.js', () => ({
      isIssueClosed: vi.fn(async () => false),
    }));
    vi.doMock('../cloister/specialists.js', () => ({
      getTmuxSessionName: vi.fn(),
      isRunning: vi.fn(async () => false),
      getAllProjectSpecialistStatuses: vi.fn(() => []),
    }));
    vi.doMock('../transcript-landing.js', () => ({
      captureTranscriptUserRecordSnapshot: vi.fn(async () => ({ sessionFile: '/tmp/session.jsonl', userRecordCount: 0 })),
    }));
    vi.doMock('../agents.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../agents.js')>()),
      messageAgent,
    }));

    const { saveAgentStateSync, getAgentStateSync } = await import('../agents.js');
    const { nudgeStalledResumeWorkAgents } = await import('../cloister/deacon.js');
    const lastResumeAt = '2026-06-10T00:01:00.000Z';

    saveAgentStateSync({
      id: 'agent-pan-resume-persist',
      issueId: 'PAN-1700',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: '2026-06-10T00:00:00.000Z',
      sessionId: 'session-1',
      lastResumeAt,
    } as any);

    expect(getAgentStateSync('agent-pan-resume-persist')?.lastResumeAt).toBe(lastResumeAt);
    await expect(nudgeStalledResumeWorkAgents()).resolves.toEqual([
      'Re-sent stalled resume prompt to agent-pan-resume-persist (PAN-1700)',
    ]);
    expect(messageAgent).toHaveBeenCalledWith(
      'agent-pan-resume-persist',
      expect.stringContaining('You are resuming work on PAN-1700'),
    );
  });

  it('accepts flywheel role in persisted state.json', async () => {
    const { getAgentStateSync, saveAgentStateSync } = await import('../agents.js');

    saveAgentStateSync({
      id: 'agent-flywheel-orchestrator',
      issueId: 'RUN-1',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'flywheel',
      model: 'claude-opus-4-7',
      status: 'running',
      startedAt: '2026-05-18T00:00:00.000Z',
    } as any);

    expect(getAgentStateSync('agent-flywheel-orchestrator')?.role).toBe('flywheel');
  });

  it('defaults Channels MCP eligibility off for new work-agent spawns', async () => {
    vi.doMock('../config-yaml.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../config-yaml.js')),
      isClaudeCodeChannelsMcpEnabled: () => false,
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

    expect(decideChannelsForWorkAgent('agent-pan-channels', {} as any, state)).toEqual({
      eligible: false,
      reason: 'mcp-default-off',
    });
  });

  it('bases Channels MCP override eligibility on work role and claude-code harness', async () => {
    vi.doMock('../config-yaml.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../config-yaml.js')),
      isClaudeCodeChannelsMcpEnabled: () => true,
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
    const resolvedProject = {
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      projectPath: workspace,
      linearTeam: 'PAN',
    };
    const projectConfig = { path: workspace, workspace: { docker: { compose_template: 'infra/.devcontainer-template' } } };
    vi.doMock('../projects.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../projects.js')),
      resolveProjectFromIssue: vi.fn(() => resolvedProject),
      resolveProjectFromIssueSync: vi.fn(() => resolvedProject),
      getProject: vi.fn(() => projectConfig),
      getProjectSync: vi.fn(() => projectConfig),
    }));
    // PAN-1618: the spawn gate now attempts an auto-rebuild before failing.
    // Mock it to fail so the gate still blocks deterministically here.
    vi.doMock('../workspace/rebuild-stack.js', () => ({
      rebuildWorkspaceStack: vi.fn(() => Effect.succeed({ success: false, error: 'rebuild unavailable in test' })),
    }));
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      sessionExists: vi.fn(() => Effect.succeed(false)),
      sessionExistsSync: vi.fn(() => false),
      createSession: vi.fn((...args: unknown[]) => Effect.promise(() => Promise.resolve(createSessionAsync(...args)))),
    }));
    vi.doMock('../beads-query.js', () => ({ assertIssueHasBeads: vi.fn(() => Effect.succeed(undefined)) }));
    vi.doMock('../activity-logger.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../activity-logger.js')),
      emitActivityEntry,
      emitActivityEntrySync: emitActivityEntry,
    }));
    const { recordDockerContainerLifecycleSnapshot } = await import('../docker-stats.js');
    recordDockerContainerLifecycleSnapshot([{
      id: 'abc123',
      name: 'overdeck-feature-pan-1140-init-1',
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
    })).rejects.toThrow("Workspace docker stack for PAN-1140 is not healthy: overdeck-feature-pan-1140-init-1 init exited non-zero (1). Run 'pan workspace rebuild PAN-1140' or retry with --host to override.");

    expect(createSessionAsync).not.toHaveBeenCalled();
    // PAN-1618: an auto-rebuild is attempted first; when it fails the gate
    // blocks and emits the failed-rebuild marker.
    expect(emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      issueId: 'PAN-1140',
      message: 'agent-spawn-stack-rebuild-failed: PAN-1140',
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
        reasons: ['overdeck-feature-pan-1140-init init exited non-zero (1)'],
        lastObserved: '2026-05-16T00:00:00.000Z',
      })),
    }));
    // PAN-1618: the spawn gate now attempts an auto-rebuild before failing.
    // Mock it to fail so the gate still blocks deterministically here.
    vi.doMock('../workspace/rebuild-stack.js', () => ({
      rebuildWorkspaceStack: vi.fn(() => Effect.succeed({ success: false, error: 'rebuild unavailable in test' })),
    }));
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      sessionExists: vi.fn(() => Effect.succeed(false)),
      sessionExistsSync: vi.fn(() => false),
      createSession: vi.fn((...args: unknown[]) => Effect.promise(() => Promise.resolve(createSessionAsync(...args)))),
    }));
    vi.doMock('../beads-query.js', () => ({ assertIssueHasBeads: vi.fn(() => Effect.succeed(undefined)) }));
    vi.doMock('../activity-logger.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../activity-logger.js')),
      emitActivityEntry,
      emitActivityEntrySync: emitActivityEntry,
    }));

    const { spawnAgent } = await import('../agents.js');

    await expect(spawnAgent({
      issueId: 'PAN-1140',
      workspace,
      role: 'work',
      model: 'claude-sonnet-4-6',
    })).rejects.toThrow("Workspace docker stack for PAN-1140 is not healthy: overdeck-feature-pan-1140-init init exited non-zero (1). Run 'pan workspace rebuild PAN-1140' or retry with --host to override.");

    expect(createSessionAsync).not.toHaveBeenCalled();
    // PAN-1618: failed auto-rebuild → blocked with the failed-rebuild marker.
    expect(emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      issueId: 'PAN-1140',
      message: 'agent-spawn-stack-rebuild-failed: PAN-1140',
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
      isClaudeCodeChannelsMcpEnabled: () => false,
    }));
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({
        healthy: false,
        reasons: ['overdeck-feature-pan-1140-server stuck Created for 180s'],
        lastObserved: '2026-05-16T00:00:00.000Z',
      })),
    }));
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      sessionExists: vi.fn(() => Effect.succeed(false)),
      sessionExistsSync: vi.fn(() => false),
      createSession: vi.fn((...args: unknown[]) => Effect.promise(() => Promise.resolve(createSessionAsync(...args)))),
      capturePane: vi.fn(() => Effect.succeed('Claude Code')),
      setOption: vi.fn(() => Effect.void),
    }));
    vi.doMock('../beads-query.js', () => ({ assertIssueHasBeads: vi.fn(() => Effect.succeed(undefined)) }));
    vi.doMock('../activity-logger.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../activity-logger.js')),
      emitActivityEntry,
      emitActivityEntrySync: emitActivityEntry,
      emitActivityTts: vi.fn(),
      emitActivityTtsSync: vi.fn(),
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
    // PAN-1556: host-override is logged via console.warn, not the activity feed
    // (it was per-spawn feed spam). The spawn proceeding + the warn is the contract.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('retry with --host to override'));
    warnSpy.mockRestore();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('PAN-2017: fails and stops a strike spawn when kickoff delivery fails', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-strike-kickoff-fail-'));
    const agentId = 'strike-pan-2017';
    const agentDir = join(tempHome, 'agents', agentId);
    const readyPath = join(agentDir, 'ready.json');
    const fifoPath = join(agentDir, 'rpc.in');
    let sessionAlive = false;
    const createSessionAsync = vi.fn(async () => {
      sessionAlive = true;
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(readyPath, JSON.stringify({ agentId, sessionId: 'omp-session' }));
    });
    const killSessionAsync = vi.fn(async () => {
      sessionAlive = false;
    });
    const writeOhmypiCommandSync = vi.fn(() => {
      throw new Error('fifo write failed');
    });
    const emitActivityEntry = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: '2026-06-25T00:00:00.000Z' })),
    }));
    vi.doMock('../workspace/rebuild-stack.js', () => ({
      rebuildWorkspaceStack: vi.fn(() => Effect.succeed({ success: true })),
    }));
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      sessionExists: vi.fn(() => Effect.succeed(sessionAlive)),
      sessionExistsSync: vi.fn(() => sessionAlive),
      createSession: vi.fn((...args: unknown[]) => Effect.promise(() => Promise.resolve(createSessionAsync(...args)))),
      killSession: vi.fn(() => Effect.promise(() => killSessionAsync())),
      capturePane: vi.fn(() => Effect.succeed('')),
      setOption: vi.fn(() => Effect.void),
    }));
    vi.doMock('../activity-logger.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../activity-logger.js')),
      emitActivityEntry,
      emitActivityEntrySync: emitActivityEntry,
      emitActivityTts: vi.fn(),
      emitActivityTtsSync: vi.fn(),
    }));
    vi.doMock('../harness-resolve.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../harness-resolve.js')),
      resolveHarness: vi.fn(async () => 'ohmypi'),
    }));
    vi.doMock('../workspace-manager.js', () => ({
      preTrustDirectory: vi.fn(),
    }));
    vi.doMock('../github-app.js', () => ({
      isGitHubAppConfigured: vi.fn(() => false),
    }));
    vi.doMock('../memory/injection.js', () => ({
      injectPromptTimeMemory: vi.fn(async () => ({ context: '' })),
    }));
    vi.doMock('../runtimes/ohmypi-fifo.js', () => ({
      OhmypiNotReady: class OhmypiNotReady extends Error {},
      ohmypiFifoPaths: vi.fn(() => ({ agentDir, readyPath, fifoPath })),
      createOhmypiFifo: vi.fn(() => Effect.succeed(fifoPath)),
      writeOhmypiCommandSync,
    }));

    try {
      const { getAgentStateSync, spawnAgent } = await import('../agents.js');
      const spawn = spawnAgent({
        issueId: 'PAN-2017',
        workspace,
        role: 'strike',
        harness: 'ohmypi',
        model: 'claude-sonnet-4-6',
        prompt: 'do the strike',
      });

      await expect(spawn).rejects.toThrow(/kickoff delivery failed/);

      expect(createSessionAsync).toHaveBeenCalled();
      expect(writeOhmypiCommandSync).toHaveBeenCalled();
      expect(killSessionAsync).toHaveBeenCalled();
      expect(sessionAlive).toBe(false);
      expect(getAgentStateSync(agentId)).toMatchObject({
        status: 'stopped',
        kickoffDelivered: false,
        lastFailureReason: 'kickoff delivery failed',
      });
      expect(emitActivityEntry).not.toHaveBeenCalledWith(expect.objectContaining({
        message: 'Work agent started for PAN-2017',
      }));
    } finally {
      process.env.HOME = originalHome;
      consoleErrorSpy.mockRestore();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('PAN-2093: gives ohmypi work-agent readiness more than the old 30s window', async () => {
    const { OHMYPI_AGENT_READY_TIMEOUT_SECONDS } = await import('../agents.js');

    expect(OHMYPI_AGENT_READY_TIMEOUT_SECONDS).toBe(120);
    expect(OHMYPI_AGENT_READY_TIMEOUT_SECONDS).toBeGreaterThan(30);
  });

  it('PAN-2100: reports disk space and recent output when ohmypi readiness times out', async () => {
    const agentId = 'agent-pan-2100';
    const agentDir = join(tempHome, 'agents', agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'output.log'), [
      'starting omp',
      'Error: ENOSPC: no space left on device, write ready.json',
    ].join('\n'));

    const { describeOhmypiSpawnFailure } = await import('../agents.js');
    const description = describeOhmypiSpawnFailure(agentId);

    expect(description).toContain('freeDisk=');
    expect(description).toContain('output.log tail:');
    expect(description).toContain('ENOSPC');
    expect(description).toContain('ready.json');
  });

  it('does not block when workspace stack health is healthy', async () => {
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: '2026-05-16T00:00:00.000Z' })),
    }));
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');

    await expect(assertWorkspaceStackHealthyForSpawn('MIN-1', 'work')).resolves.toBeUndefined();
  });

  it('PAN-1618: auto-rebuilds an unhealthy stack and then permits the spawn', async () => {
    const emitActivityEntry = vi.fn();
    const rebuildWorkspaceStack = vi.fn(() => Effect.succeed({ success: true }));
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({
        healthy: false,
        reasons: ['No Docker containers found for workspace stack pan-1579'],
        lastObserved: '2026-06-04T00:00:00.000Z',
      })),
    }));
    vi.doMock('../workspace/rebuild-stack.js', () => ({ rebuildWorkspaceStack }));
    vi.doMock('../activity-logger.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../activity-logger.js')),
      emitActivityEntry,
      emitActivityEntrySync: emitActivityEntry,
    }));

    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');

    // Unhealthy stack + successful rebuild ⇒ the gate resolves rather than throwing,
    // so a `proposed` item reaches a running work agent with no human step.
    await expect(assertWorkspaceStackHealthyForSpawn('PAN-1579', 'work')).resolves.toBeUndefined();
    expect(rebuildWorkspaceStack).toHaveBeenCalledWith('PAN-1579', expect.any(Object));
    expect(emitActivityEntry).not.toHaveBeenCalled();
  });

  it('PAN-1645: review/test/ship auto-fall-back to host (no throw) when the stack stays unhealthy; work still blocks', async () => {
    const emitActivityEntry = vi.fn();
    const rebuildWorkspaceStack = vi.fn(() => Effect.succeed({ success: false, error: 'init exited non-zero (1)' }));
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({
        healthy: false,
        reasons: ['overdeck-feature-init-1 init exited non-zero (1)'],
        lastObserved: '2026-06-08T00:00:00.000Z',
      })),
    }));
    vi.doMock('../workspace/rebuild-stack.js', () => ({ rebuildWorkspaceStack }));
    vi.doMock('../activity-logger.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../activity-logger.js')),
      emitActivityEntry,
      emitActivityEntrySync: emitActivityEntry,
    }));

    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');

    // ship/review/test operate on the host (rebase/diff/host gates) — an
    // unhealthy stack must NOT block them: the gate resolves (host fallback).
    await expect(assertWorkspaceStackHealthyForSpawn('PAN-7001', 'ship')).resolves.toBeUndefined();
    await expect(assertWorkspaceStackHealthyForSpawn('PAN-7002', 'review')).resolves.toBeUndefined();
    await expect(assertWorkspaceStackHealthyForSpawn('PAN-7003', 'test')).resolves.toBeUndefined();
    expect(emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: expect.stringContaining('agent-spawn-host-fallback'),
    }));
    // work, by contrast, may need the dev container — it still blocks.
    await expect(assertWorkspaceStackHealthyForSpawn('PAN-7004', 'work')).rejects.toThrow('is not healthy');
    expect(emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      message: expect.stringContaining('agent-spawn-stack-rebuild-failed'),
    }));
  });

  it('PAN-1872: does not crash on undefined issueId while checking workspace stack health', async () => {
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: '2026-06-13T00:00:00.000Z' })),
    }));
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');

    await expect(assertWorkspaceStackHealthyForSpawn(undefined as any, 'work')).resolves.toBeUndefined();
  });

  it('PAN-2009: fresh-launches a stopped ohmypi agent when the prior ohmypi process is dead', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-dead-pi-resume-'));
    const agentId = 'agent-pan-2009-review';
    const createSessionAsync = vi.fn(async () => {
      writeFileSync(join(tempHome, 'agents', agentId, 'ready.json'), JSON.stringify({
        agentId,
        sessionId: 'fresh-pi-session',
      }));
    });
    const killSessionAsync = vi.fn(async () => undefined);
    const writeOhmypiCommandSync = vi.fn();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: '2026-06-23T00:00:00.000Z' })),
    }));
    vi.doMock('../workspace/rebuild-stack.js', () => ({
      rebuildWorkspaceStack: vi.fn(() => Effect.succeed({ success: true })),
    }));
    vi.doMock('../projects.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../projects.js')),
      resolveProjectFromIssueSync: vi.fn(() => null),
    }));
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      sessionExists: vi.fn(() => Effect.succeed(true)),
      sessionExistsSync: vi.fn(() => true),
      killSession: vi.fn(() => Effect.promise(() => killSessionAsync())),
      createSession: vi.fn((...args: unknown[]) => Effect.promise(() => Promise.resolve(createSessionAsync(...args)))),
      listPaneValues: vi.fn(() => Effect.succeed([])),
      capturePane: vi.fn(() => Effect.succeed('')),
      setOption: vi.fn(() => Effect.void),
    }));
    vi.doMock('../agent-runtime-mirror.js', () => ({
      getRuntimeSnapshot: vi.fn(() => Effect.succeed({
        activity: 'stopped',
        lastActivity: '2026-06-23T00:00:00.000Z',
        sessionModel: 'claude-sonnet-4-6',
        sessionHarness: 'ohmypi',
      })),
      isAgentStateServiceInProcess: vi.fn(() => Effect.succeed(true)),
    }));
    vi.doMock('../harness-resolve.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../harness-resolve.js')),
      resolveHarness: vi.fn(async () => 'ohmypi'),
    }));
    vi.doMock('../runtimes/ohmypi-fifo.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../runtimes/ohmypi-fifo.js')),
      writeOhmypiCommandSync,
    }));

    const { resumeAgent, saveAgentStateSync } = await import('../agents.js');
    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-2009',
      workspace,
      harness: 'ohmypi',
      role: 'review',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: '2026-06-23T00:00:00.000Z',
    } as any);
    writeFileSync(join(tempHome, 'agents', agentId, 'session.id'), 'dead-pi-session');

    await expect(resumeAgent(agentId, 'continue review')).resolves.toMatchObject({
      success: true,
      messageDelivered: true,
    });

    expect(killSessionAsync).toHaveBeenCalled();
    expect(createSessionAsync).toHaveBeenCalled();
    expect(writeOhmypiCommandSync).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({ type: 'prompt', message: expect.stringContaining('continue review') }),
    );
    const launcher = readFileSync(join(tempHome, 'agents', agentId, 'launcher.sh'), 'utf-8');
    expect(launcher).not.toContain('--resume');
    expect(existsSync(join(tempHome, 'agents', agentId, 'session.id'))).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('prior Pi process was dead'));

    consoleSpy.mockRestore();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('resumes a status=starting agent whose tmux session died (runtime=stopped desync)', async () => {
    // Regression: an agent stuck in status='starting' (spawn got past model
    // resolution but tmux died mid-launch) with a dead session produces
    // runtime=stopped, status=starting. The deacon patrol would normally heal
    // starting→stopped, but only if it is running / not in OVERDECK_NO_RESUME.
    // The lifecycle UI model treats runtime=stopped as isStopped (enabling the
    // Resume button), but resumeAgent's gate only treated status='running' as
    // crashed — so status='starting' was bricked with
    // "Cannot resume agent in state: runtime=stopped, status=starting".
    // Fix: isCrashed now also covers status='starting' with no live session.
    const workspace = mkdtempSync(join(tmpdir(), 'pan-starting-resume-'));
    const agentId = 'agent-pan-2031-review';
    const createSessionAsync = vi.fn(async () => {
      writeFileSync(join(tempHome, 'agents', agentId, 'ready.json'), JSON.stringify({
        agentId,
        sessionId: 'fresh-session',
      }));
    });
    const killSessionAsync = vi.fn(async () => undefined);
    const writeOhmypiCommandSync = vi.fn();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: '2026-06-23T00:00:00.000Z' })),
    }));
    vi.doMock('../workspace/rebuild-stack.js', () => ({
      rebuildWorkspaceStack: vi.fn(() => Effect.succeed({ success: true })),
    }));
    vi.doMock('../projects.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../projects.js')),
      resolveProjectFromIssueSync: vi.fn(() => null),
    }));
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      sessionExists: vi.fn(() => Effect.succeed(false)),
      sessionExistsSync: vi.fn(() => false),
      killSession: vi.fn(() => Effect.promise(() => killSessionAsync())),
      createSession: vi.fn((...args: unknown[]) => Effect.promise(() => Promise.resolve(createSessionAsync(...args)))),
      listPaneValues: vi.fn(() => Effect.succeed([])),
      capturePane: vi.fn(() => Effect.succeed('')),
      setOption: vi.fn(() => Effect.void),
    }));
    vi.doMock('../agent-runtime-mirror.js', () => ({
      getRuntimeSnapshot: vi.fn(() => Effect.succeed({
        activity: 'stopped',
        lastActivity: '2026-06-23T00:00:00.000Z',
        sessionModel: 'claude-sonnet-4-6',
        sessionHarness: 'ohmypi',
      })),
      isAgentStateServiceInProcess: vi.fn(() => Effect.succeed(true)),
    }));
    vi.doMock('../harness-resolve.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../harness-resolve.js')),
      resolveHarness: vi.fn(async () => 'ohmypi'),
    }));
    vi.doMock('../runtimes/ohmypi-fifo.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../runtimes/ohmypi-fifo.js')),
      writeOhmypiCommandSync,
    }));

    const { resumeAgent, saveAgentStateSync } = await import('../agents.js');
    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-2031',
      workspace,
      harness: 'ohmypi',
      role: 'review',
      model: 'claude-sonnet-4-6',
      status: 'starting', // <-- the stuck state from the bug report
      startedAt: '2026-06-23T00:00:00.000Z',
    } as any);
    writeFileSync(join(tempHome, 'agents', agentId, 'session.id'), 'dead-session');

    const result = await resumeAgent(agentId, 'continue review');

    // Before the fix this returned
    // { success: false, error: 'Cannot resume agent in state: runtime=stopped, status=starting' }
    expect(result).toMatchObject({ success: true, messageDelivered: true });
    expect(result.error).toBeUndefined();
    expect(createSessionAsync).toHaveBeenCalled();

    consoleSpy.mockRestore();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('treats state.json without a valid role as missing', async () => {
    const { getAgentStateSync } = await import('../agents.js');
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

    const state = getAgentStateSync('agent-pan-legacy');
    expect(state).toBeNull();
  });

  it('drops legacy agent state directories missing role during startup scan', async () => {
    vi.doMock('../tmux.js', async (importOriginal) => ({
      ...((await importOriginal()) as typeof import('../tmux.js')),
      killSession: vi.fn(),
  killSessionSync: vi.fn(),
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
