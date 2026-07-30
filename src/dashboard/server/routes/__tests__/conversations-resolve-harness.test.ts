import { describe, expect, it, vi } from 'vitest';

const resolveHarnessMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/harness-resolve.js', () => ({
  resolveHarness: resolveHarnessMock,
}));

import { resolveAllowedHarness } from '../../../../lib/overdeck/conversation-runtime.js';

describe('resolveAllowedHarness (PAN-1842)', () => {
  it('returns claude-code when no model is provided', async () => {
    expect(await resolveAllowedHarness('ohmypi', null)).toBe('claude-code');
    expect(await resolveAllowedHarness(undefined, undefined)).toBe('claude-code');
    expect(resolveHarnessMock).not.toHaveBeenCalled();
  });

  it('routes non-Anthropic models through resolveHarness so provider defaults apply', async () => {
    resolveHarnessMock.mockImplementation(async ({ explicit, model }) => {
      if (model === 'gpt-5.5') return explicit ?? 'codex';
      if (model === 'kimi-k2.6') return explicit ?? 'ohmypi';
      return 'claude-code';
    });

    const gptDefault = await resolveAllowedHarness(undefined, 'gpt-5.5');
    expect(gptDefault).toBe('codex');
    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'gpt-5.5', explicit: undefined });

    const kimiDefault = await resolveAllowedHarness('not-a-harness', 'kimi-k2.6');
    expect(kimiDefault).toBe('ohmypi');
    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'kimi-k2.6', explicit: undefined });

    const explicitOhmypi = await resolveAllowedHarness('ohmypi', 'kimi-k2.6');
    expect(explicitOhmypi).toBe('ohmypi');
    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'kimi-k2.6', explicit: 'ohmypi' });
  });

  it('routes an explicit kimi-code request through resolveHarness rather than falling through to the default', async () => {
    resolveHarnessMock.mockImplementation(async ({ explicit }) => explicit ?? 'claude-code');

    const explicitKimiCode = await resolveAllowedHarness('kimi-code', 'kimi-k2.6');
    expect(explicitKimiCode).toBe('kimi-code');
    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'kimi-k2.6', explicit: 'kimi-code' });
  });

  it('surfaces resolveHarness errors instead of falling back to claude-code', async () => {
    resolveHarnessMock.mockRejectedValue(new Error('model denied'));

    await expect(resolveAllowedHarness(undefined, 'gpt-5.5')).rejects.toThrow('model denied');
  });
});
