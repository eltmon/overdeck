import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfigNoMigration: vi.fn(),
  getClaudeAuthStatus: vi.fn(),
  getOpenAIAuthStatus: vi.fn(),
}));

vi.mock('../../../../lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigNoMigration: mocks.loadConfigNoMigration,
  };
});

vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>();
  return {
    ...actual,
  };
});

vi.mock('../../../../lib/claude-auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/claude-auth.js')>();
  return {
    ...actual,
    getClaudeAuthStatus: mocks.getClaudeAuthStatus,
  };
});

vi.mock('../../../../lib/openai-auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/openai-auth.js')>();
  return {
    ...actual,
    getOpenAIAuthStatus: mocks.getOpenAIAuthStatus,
  };
});

async function loadSubject() {
  return import('../conversations.js');
}

describe('resolveInitialConversationHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigNoMigration.mockReturnValue(
      Effect.succeed({
        config: {
          providerHarnesses: { openai: 'codex' },
          providerAuth: { openai: 'subscription' },
        },
      }),
    );
    mocks.getClaudeAuthStatus.mockReturnValue(
      Effect.succeed({ loggedIn: true, hasAnthropicApiKey: false }),
    );
    mocks.getOpenAIAuthStatus.mockReturnValue(
      Effect.succeed({ loggedIn: true, hasOpenAIApiKey: false }),
    );
  });

  it('returns claude-code without consulting config when no model is provided', async () => {
    const { resolveInitialConversationHarness } = await loadSubject();

    await expect(resolveInitialConversationHarness(undefined, undefined)).resolves.toBe('claude-code');

    expect(mocks.loadConfigNoMigration).not.toHaveBeenCalled();
    expect(mocks.getClaudeAuthStatus).not.toHaveBeenCalled();
    expect(mocks.getOpenAIAuthStatus).not.toHaveBeenCalled();
  });

  it('uses async config loading for flagless conversation creation with a model', async () => {
    const { resolveInitialConversationHarness } = await loadSubject();

    await expect(resolveInitialConversationHarness(undefined, 'gpt-5.5')).resolves.toBe('codex');

    expect(mocks.loadConfigNoMigration).toHaveBeenCalled();
    expect(mocks.getOpenAIAuthStatus).toHaveBeenCalled();
  });

  it('preserves explicit requested harness behavior through the policy gate', async () => {
    const { resolveInitialConversationHarness } = await loadSubject();

    await expect(resolveInitialConversationHarness('pi', 'claude-sonnet-4-6')).resolves.toBe('claude-code');
    await expect(resolveInitialConversationHarness('codex', 'gpt-5.5')).resolves.toBe('codex');

    expect(mocks.getClaudeAuthStatus).toHaveBeenCalled();
    expect(mocks.getOpenAIAuthStatus).toHaveBeenCalled();
    expect(mocks.loadConfigNoMigration).toHaveBeenCalled();
  });

  it('falls back to claude-code when no explicit harness is requested for an anthropic model', async () => {
    const { resolveInitialConversationHarness } = await loadSubject();

    await expect(resolveInitialConversationHarness(undefined, 'claude-sonnet-4-6')).resolves.toBe('claude-code');

    expect(mocks.loadConfigNoMigration).toHaveBeenCalled();
    expect(mocks.getClaudeAuthStatus).toHaveBeenCalled();
  });
});
