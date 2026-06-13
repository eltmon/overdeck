import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveHarness: vi.fn(),
  getProviderAuthMode: vi.fn(),
}));

vi.mock('../../../../lib/harness-resolve.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/harness-resolve.js')>();
  return {
    ...actual,
    resolveHarness: mocks.resolveHarness,
  };
});

vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>();
  return {
    ...actual,
    getProviderAuthMode: mocks.getProviderAuthMode,
  };
});

async function loadSubject() {
  return import('../conversations.js');
}

describe('resolveInitialConversationHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHarness.mockResolvedValue('codex');
    mocks.getProviderAuthMode.mockResolvedValue(undefined);
  });

  it('uses resolveHarness for flagless conversation creation with a model', async () => {
    const { resolveInitialConversationHarness } = await loadSubject();

    await expect(resolveInitialConversationHarness(undefined, 'gpt-5.5')).resolves.toBe('codex');

    expect(mocks.resolveHarness).toHaveBeenCalledWith({ model: 'gpt-5.5' });
  });

  it('returns claude-code without consulting resolveHarness when no model is provided', async () => {
    const { resolveInitialConversationHarness } = await loadSubject();

    await expect(resolveInitialConversationHarness(undefined, undefined)).resolves.toBe('claude-code');

    expect(mocks.resolveHarness).not.toHaveBeenCalled();
    expect(mocks.getProviderAuthMode).not.toHaveBeenCalled();
  });

  it('preserves explicit requested harness behavior through the policy gate', async () => {
    mocks.getProviderAuthMode.mockResolvedValue('subscription');
    const { resolveInitialConversationHarness } = await loadSubject();

    await expect(resolveInitialConversationHarness('pi', 'claude-sonnet-4-6')).resolves.toBe('claude-code');
    await expect(resolveInitialConversationHarness('codex', 'gpt-5.5')).resolves.toBe('codex');

    expect(mocks.resolveHarness).not.toHaveBeenCalled();
    expect(mocks.getProviderAuthMode).toHaveBeenCalledWith('claude-sonnet-4-6');
    expect(mocks.getProviderAuthMode).toHaveBeenCalledWith('gpt-5.5');
  });

  it('falls back to claude-code when resolveHarness rejects with HarnessResolutionError', async () => {
    const { HarnessResolutionError } = await import('../../../../lib/harness-resolve.js');
    mocks.resolveHarness.mockRejectedValue(new HarnessResolutionError('blocked'));
    const { resolveInitialConversationHarness } = await loadSubject();

    await expect(resolveInitialConversationHarness(undefined, 'gpt-5.5')).resolves.toBe('claude-code');

    expect(mocks.resolveHarness).toHaveBeenCalledWith({ model: 'gpt-5.5' });
  });
});
