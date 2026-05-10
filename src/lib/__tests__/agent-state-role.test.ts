import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    delete process.env.PANOPTICON_HOME;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('resolves the work role model through role config defaults', async () => {
    const { determineModel } = await import('../agents.js');

    expect(determineModel({ role: 'work' })).toBe('claude-sonnet-4-6');
    expect(determineModel({ role: 'work', model: 'claude-opus-4-7' })).toBe('claude-opus-4-7');
  });

  it('builds review role runtime commands from roles/review.md', async () => {
    const { getRoleRuntimeBaseCommand, roleAgentDefinitionPath, spawnRun } = await import('../agents.js');

    expect(roleAgentDefinitionPath('review')).toBe('roles/review.md');
    expect(spawnRun).toEqual(expect.any(Function));

    const command = await getRoleRuntimeBaseCommand('claude-opus-4-7', 'agent-pan-1048-review', 'review');
    expect(command).toContain('--agent roles/review.md');
    expect(command).toContain('--model claude-opus-4-7');
    expect(command).toContain('--name agent-pan-1048-review');
    expect(command).not.toContain('pan-review-agent');
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

    expect(getAgentState('agent-pan-legacy')).toBeNull();
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

    warnOnBareNumericIssueIds();

    expect(existsSync(legacyDir)).toBe(false);
    expect(existsSync(validDir)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith('[agents] Dropped 1 legacy agent state file(s) missing role');
    warnSpy.mockRestore();
  });
});
