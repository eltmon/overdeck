import { describe, expect, it, vi } from 'vitest';
import { resolvePlanningSessionHarness } from '../spawn-planning-session.js';

const mocks = vi.hoisted(() => ({
  resolveHarness: vi.fn(),
}));

vi.mock('../../harness-resolve.js', () => ({
  resolveHarness: mocks.resolveHarness,
}));

describe('resolvePlanningSessionHarness', () => {
  it('uses resolveHarness for provider defaults and explicit overrides', async () => {
    mocks.resolveHarness.mockImplementation(async ({ explicit, model }) => {
      if (explicit) return explicit;
      return model === 'gpt-5.5' ? 'codex' : 'claude-code';
    });

    await expect(resolvePlanningSessionHarness('gpt-5.5')).resolves.toBe('codex');
    await expect(resolvePlanningSessionHarness('gpt-5.5', 'pi')).resolves.toBe('pi');

    expect(mocks.resolveHarness).toHaveBeenNthCalledWith(1, {
      explicit: undefined,
      role: 'plan',
      model: 'gpt-5.5',
    });
    expect(mocks.resolveHarness).toHaveBeenNthCalledWith(2, {
      explicit: 'pi',
      role: 'plan',
      model: 'gpt-5.5',
    });
  });
});
