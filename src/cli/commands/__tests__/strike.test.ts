import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { Effect } from 'effect';

const agentMocks = vi.hoisted(() => ({
  getAgentRuntimeState: vi.fn(),
  spawnAgent: vi.fn(),
  stopAgent: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExists: vi.fn(),
}));

vi.mock('../../../lib/agents.js', () => ({
  getAgentRuntimeState: agentMocks.getAgentRuntimeState,
  spawnAgent: agentMocks.spawnAgent,
  stopAgent: agentMocks.stopAgent,
}));

vi.mock('../../../lib/tmux.js', () => ({
  sessionExists: tmuxMocks.sessionExists,
}));

import { strikeCommand, __testInternals } from '../strike.js';

describe('strikeCommand', () => {
  beforeEach(() => {
    agentMocks.getAgentRuntimeState.mockReset();
    agentMocks.spawnAgent.mockReset();
    agentMocks.stopAgent.mockReset();
    tmuxMocks.sessionExists.mockReset();
  });

  it('exports a function', () => {
    expect(typeof strikeCommand).toBe('function');
  });

  it('parses multiple positional issue IDs through commander', () => {
    const program = new Command();
    let capturedIds: string[] = [];
    let capturedOptions: Record<string, unknown> = {};

    program
      .command('strike <ids...>')
      .option('--model <model>', 'Model override')
      .option('--harness <harness>', 'Harness')
      .option('--effort <level>', 'Effort')
      .option('--dry-run', 'Dry run')
      .action((ids: string[], options: Record<string, unknown>) => {
        capturedIds = ids;
        capturedOptions = options;
      });

    // Mimic `pan strike PAN-1052 PAN-1141 --model claude-sonnet-4-6 --dry-run`
    program.parse(['strike', 'PAN-1052', 'PAN-1141', '--model', 'claude-sonnet-4-6', '--dry-run'], { from: 'user' });

    expect(capturedIds).toEqual(['PAN-1052', 'PAN-1141']);
    expect(capturedOptions.model).toBe('claude-sonnet-4-6');
    expect(capturedOptions.dryRun).toBe(true);
  });

  it('buildStrikePrompt includes the issue id, branch, and workspace', () => {
    const fakePlan = {
      issueId: 'PAN-1234',
      workspace: '/tmp/feature-pan-1234-strike',
      branch: 'strike/pan-1234',
      sessionName: 'strike-pan-1234',
      projectRoot: '/tmp/project',
    };
    const prompt = __testInternals.buildStrikePrompt(fakePlan);
    expect(prompt).toContain('PAN-1234');
    expect(prompt).toContain('strike/pan-1234');
    expect(prompt).toContain('/tmp/feature-pan-1234-strike');
    expect(prompt).toContain('merge fast-forward to `main`');
    expect(prompt).toContain('pan done PAN-1234 --strike');
    // Strike must explicitly not call the normal review-pipeline form.
    expect(prompt).toContain('Do NOT call plain `pan done`');
  });

  it('clears an idle prior strike session so the issue can be struck again', async () => {
    const fakePlan = {
      issueId: 'PAN-2022',
      workspace: '/tmp/feature-pan-2022-strike',
      branch: 'strike/pan-2022',
      sessionName: 'strike-pan-2022',
      projectRoot: '/tmp/project',
    };
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    agentMocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
      state: 'idle',
      lastActivity: '2026-06-24T00:00:00.000Z',
    }));
    agentMocks.stopAgent.mockReturnValue(Effect.void);

    await expect(__testInternals.clearIdlePriorStrike(fakePlan)).resolves.toBe(true);

    expect(agentMocks.stopAgent).toHaveBeenCalledWith('strike-pan-2022');
  });

  it('does not clear an active prior strike session', async () => {
    const fakePlan = {
      issueId: 'PAN-2022',
      workspace: '/tmp/feature-pan-2022-strike',
      branch: 'strike/pan-2022',
      sessionName: 'strike-pan-2022',
      projectRoot: '/tmp/project',
    };
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(true));
    agentMocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
      state: 'active',
      lastActivity: '2026-06-24T00:00:00.000Z',
    }));

    await expect(__testInternals.clearIdlePriorStrike(fakePlan)).rejects.toThrow(/already running/);

    expect(agentMocks.stopAgent).not.toHaveBeenCalled();
  });
});
