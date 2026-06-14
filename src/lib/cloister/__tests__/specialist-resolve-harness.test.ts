import { describe, expect, it, vi } from 'vitest';

const resolveHarnessMock = vi.hoisted(() => vi.fn());
const getAgentRuntimeBaseCommandMock = vi.hoisted(() => vi.fn());

vi.mock('../../harness-resolve.js', () => ({
  resolveHarness: resolveHarnessMock,
}));

vi.mock('../../agents.js', () => ({
  getAgentRuntimeBaseCommand: getAgentRuntimeBaseCommandMock,
}));

import { buildSpecialistBaseCommand } from '../specialists.js';

describe('buildSpecialistBaseCommand harness resolution (PAN-1842)', () => {
  it('routes every harness decision through resolveHarness with the specialist role', async () => {
    resolveHarnessMock.mockResolvedValue('pi');
    getAgentRuntimeBaseCommandMock.mockResolvedValue('pi-launcher-cmd');

    const cmd = await buildSpecialistBaseCommand('review-agent', 'kimi-k2.6', 'sess-1');

    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'kimi-k2.6', role: 'review' });
    expect(getAgentRuntimeBaseCommandMock).toHaveBeenCalledWith(
      'kimi-k2.6',
      'sess-1',
      'pan-review-agent',
      'pi',
    );
    expect(cmd).toBe('pi-launcher-cmd');
  });

  it('yields the provider default for a non-Anthropic model with no explicit/role/provider override', async () => {
    resolveHarnessMock.mockImplementation(async ({ model }) => {
      if (model === 'gpt-5.5') return 'codex';
      if (model === 'kimi-k2.6') return 'pi';
      return 'claude-code';
    });
    getAgentRuntimeBaseCommandMock.mockResolvedValue('launcher-cmd');

    await buildSpecialistBaseCommand('test-agent', 'gpt-5.5', 'sess-2');

    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'gpt-5.5', role: 'test' });
    expect(getAgentRuntimeBaseCommandMock).toHaveBeenCalledWith(
      'gpt-5.5',
      'sess-2',
      'pan-test-agent',
      'codex',
    );

    await buildSpecialistBaseCommand('review-agent', 'kimi-k2.6', 'sess-3');

    expect(resolveHarnessMock).toHaveBeenCalledWith({ model: 'kimi-k2.6', role: 'review' });
    expect(getAgentRuntimeBaseCommandMock).toHaveBeenCalledWith(
      'kimi-k2.6',
      'sess-3',
      'pan-review-agent',
      'pi',
    );
  });
});
