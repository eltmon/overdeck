/**
 * PAN-3917 W12: the PTY supervisor is a TMUX-ONLY delivery mechanism.
 *
 * Live on 2026-09-19, in a throwaway workspace on the production Herdr session:
 * a pane running `bash launcher.sh → node pty-supervisor.js claude …` was
 * polled for 56s and Herdr reported `agent: null, agent_status: unknown`
 * throughout, while `pane.process_info` showed the pane's foreground process as
 * `node …/pty-supervisor.js claude …`. The same launcher with the wrapper
 * removed (`exec claude …`) was detected in ~2s as `agent: claude`. The pane's
 * terminal title was correct in BOTH runs (`✳ agent-fix11-sup`), so Herdr's
 * detector keys on the foreground process, not the title — the wrapper's
 * node-pty hides the harness and no title stamp can fix it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideSupervisorForWorkAgent, prepareSupervisorForFreshLaunch } from '../../../../src/lib/agents/supervisor-channels.js';
import { generateLauncherScriptSync } from '../../../../src/lib/launcher-generator.js';
import type { AgentState } from '../../../../src/lib/agents/agent-state.js';

function workState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-3705',
    issueId: 'PAN-3705',
    workspace: '/tmp/workspaces/feature-pan-3705',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-5',
    status: 'starting',
    startedAt: new Date().toISOString(),
    ...overrides,
  } as AgentState;
}

const spawnOptions = {
  issueId: 'PAN-3705',
  workspace: '/tmp/workspaces/feature-pan-3705',
  role: 'work' as const,
  model: 'claude-sonnet-5',
  harness: 'claude-code' as const,
};

let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decideSupervisorForWorkAgent — terminal backend', () => {
  it('refuses the supervisor on Herdr and names the reason', () => {
    const decision = decideSupervisorForWorkAgent(
      'agent-pan-3705',
      { ...spawnOptions, backend: 'herdr' },
      workState(),
    );

    expect(decision).toEqual({ eligible: false, reason: 'herdr-backend' });
    expect(logged).toContain('[agent-pan-3705] supervisor:ineligible:herdr-backend');
  });

  it('keeps the supervisor on tmux — the transport it was built for', () => {
    const decision = decideSupervisorForWorkAgent(
      'agent-pan-3705',
      { ...spawnOptions, backend: 'tmux' },
      workState(),
    );

    expect(decision).toEqual({ eligible: true });
    expect(logged).toContain('[agent-pan-3705] supervisor:eligible');
  });

  it('refuses on Herdr for strike agents too, not only work agents', () => {
    const decision = decideSupervisorForWorkAgent(
      'strike-pan-3705',
      { ...spawnOptions, role: 'strike', backend: 'herdr' },
      workState({ id: 'strike-pan-3705', role: 'strike' }),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('herdr-backend');
  });
});

describe('prepareSupervisorForFreshLaunch — Herdr', () => {
  it('produces a supervisor-less launch and leaves no supervisorEnabled stamp', async () => {
    const state = workState({ supervisorEnabled: true });

    const result = await prepareSupervisorForFreshLaunch(
      'agent-pan-3705',
      { ...spawnOptions, backend: 'herdr' },
      state,
    );

    expect(result).toEqual({ useSupervisor: false });
    expect(result.supervisorScriptPath).toBeUndefined();
    expect(state.supervisorEnabled).toBeUndefined();
  });
});

describe('launcher shape without the supervisor', () => {
  const launcherConfig = {
    role: 'work' as const,
    workingDir: '/tmp/workspaces/feature-pan-3705',
    harness: 'claude-code' as const,
    model: 'claude-sonnet-5',
    baseCommand: 'claude --permission-mode bypassPermissions --name agent-pan-3705',
  };

  it('execs the harness directly, so the pane\'s foreground process is the harness', () => {
    const script = generateLauncherScriptSync({ ...launcherConfig, useSupervisor: false });

    const execLine = script.trimEnd().split('\n').at(-1) ?? '';
    expect(execLine.startsWith('exec claude ')).toBe(true);
    expect(script).not.toContain('pty-supervisor.js');
  });

  it('still wraps when the supervisor is asked for (the tmux path is unchanged)', () => {
    const script = generateLauncherScriptSync({
      ...launcherConfig,
      useSupervisor: true,
      supervisorScriptPath: '/repo/dist/pty-supervisor.js',
    });

    const execLine = script.trimEnd().split('\n').at(-1) ?? '';
    expect(execLine.startsWith("exec node '/repo/dist/pty-supervisor.js' claude ")).toBe(true);
  });
});
