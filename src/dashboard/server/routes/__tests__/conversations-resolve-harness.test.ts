import { describe, expect, it, vi } from 'vitest';

const resolveHarnessMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/harness-resolve.js', () => ({
  resolveHarness: resolveHarnessMock,
}));

import { resolveAllowedHarness } from '../conversations.js';

describe('resolveAllowedHarness (PAN-1842)', () => {
  it('returns claude-code when no model is provided', async () => {
    expect(await resolveAllowedHarness('pi', null)).toBe('claude-code');
    expect(await resolveAllowedHarness(undefined, undefined)).toBe('claude-code');
    expect(resolveHarnessMock).not.toHaveBeenCalled();
  });

  it('routes non-Anthropic models through resolveHarness so provider defaults apply', async () => {
    resolveHarnessMock.mockImplementation(async ({ explicit, model }) => {
      if (model === 'gpt-5.5') return explicit ?? 'codex';
      if (model === 'kimi-k2.6') return explicit ?? 'pi';
      return 'claude-code';
    });

    const gptDefault = await resolveAllowedHarness(undefined, 'gpt-5.5');
    expect(gptDefault).toBe('codex');
    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'gpt-5.5', explicit: undefined });

    const kimiDefault = await resolveAllowedHarness('not-a-harness', 'kimi-k2.6');
    expect(kimiDefault).toBe('pi');
    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'kimi-k2.6', explicit: undefined });

    const explicitPi = await resolveAllowedHarness('pi', 'kimi-k2.6');
    expect(explicitPi).toBe('pi');
    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'kimi-k2.6', explicit: 'pi' });
  });

  it('falls back to claude-code when resolveHarness throws', async () => {
    resolveHarnessMock.mockRejectedValue(new Error('model denied'));

    expect(await resolveAllowedHarness(undefined, 'gpt-5.5')).toBe('claude-code');
  });
});
