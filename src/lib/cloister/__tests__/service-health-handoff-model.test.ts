import { beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-4160: a handoff trigger with no suggested model hands off to the agent's
// configured role model, or is skipped with an error — never a literal.
const mocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  checkAllTriggers: vi.fn(),
  performHandoff: vi.fn(),
  determineModel: vi.fn(),
}));

vi.mock('../../agents.js', () => ({
  getAgentState: mocks.getAgentState,
  listRunningAgents: vi.fn(),
}));
vi.mock('../triggers.js', () => ({ checkAllTriggers: mocks.checkAllTriggers }));
vi.mock('../handoff.js', () => ({ performHandoff: mocks.performHandoff }));
vi.mock('../../agents/provider-env.js', () => ({ determineModel: mocks.determineModel }));
vi.mock('../handoff-logger.js', () => ({ createHandoffEvent: vi.fn(), logHandoffEvent: vi.fn() }));

import { checkHandoffTriggers, type HealthHost } from '../service-health.js';
import type { AgentHealth } from '../health.js';

function host(): HealthHost & { emit: ReturnType<typeof vi.fn> } {
  return { config: {}, emit: vi.fn() } as unknown as HealthHost & { emit: ReturnType<typeof vi.fn> };
}

const health = { agentId: 'agent-pan-4160' } as AgentHealth;

describe('checkHandoffTriggers target model (PAN-4160)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getAgentState.mockReset().mockReturnValue({
      id: 'agent-pan-4160', issueId: 'PAN-4160', role: 'work', model: 'claude-haiku-4-5', workspace: '/ws/feature-pan-4160',
    });
    mocks.checkAllTriggers.mockReset().mockResolvedValue([
      { triggered: true, type: 'test_failure', reason: 'tests failed', confidence: 'high' },
    ]);
    mocks.performHandoff.mockReset().mockResolvedValue({ success: true, method: 'kill-spawn' });
    mocks.determineModel.mockReset();
  });

  it('hands off to the role model routing resolves when the trigger names none', async () => {
    mocks.determineModel.mockReturnValue('cfg-work-model');

    await checkHandoffTriggers(host(), [health]);

    expect(mocks.determineModel).toHaveBeenCalledWith({ role: 'work', spawnKey: 'work:PAN-4160' });
    expect(mocks.performHandoff).toHaveBeenCalledWith('agent-pan-4160', expect.objectContaining({ targetModel: 'cfg-work-model' }));
  });

  it('keeps the model the trigger suggests', async () => {
    mocks.checkAllTriggers.mockResolvedValue([
      { triggered: true, type: 'stuck_escalation', reason: 'stuck', suggestedModel: 'opus', confidence: 'high' },
    ]);

    await checkHandoffTriggers(host(), [health]);

    expect(mocks.determineModel).not.toHaveBeenCalled();
    expect(mocks.performHandoff).toHaveBeenCalledWith('agent-pan-4160', expect.objectContaining({ targetModel: 'opus' }));
  });

  it('skips the handoff with a clear error when routing cannot resolve a model', async () => {
    mocks.determineModel.mockImplementation(() => { throw new Error('roles.work.model unset'); });
    const h = host();

    await checkHandoffTriggers(h, [health]);

    expect(mocks.performHandoff).not.toHaveBeenCalled();
    expect(h.emit).toHaveBeenCalledWith({
      type: 'handoff_completed',
      agentId: 'agent-pan-4160',
      result: expect.objectContaining({
        success: false,
        error: expect.stringMatching(/No default model configured for role "work" \(PAN-4160\)/),
      }),
    });
  });
});
