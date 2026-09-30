/**
 * PAN-4400 review: the default credential check is a presence check. For
 * OpenAI, getProviderAuthMode falls back to 'api-key' when nothing is
 * configured, so the plan must gate on the Codex sign-in / API-key facts
 * instead. Only the auth and config readers are mocked here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOpenAIAuthStatus: vi.fn(),
  loadConfigNoMigration: vi.fn(),
}));

vi.mock('../../../../src/lib/openai-auth.js', () => ({ getOpenAIAuthStatus: mocks.getOpenAIAuthStatus }));
vi.mock('../../../../src/lib/config-yaml/load.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/config-yaml/load.js')>()),
  loadConfigNoMigration: mocks.loadConfigNoMigration,
}));

const { defaultPresetPlanDeps, planPresetApply } = await import('../../../../src/lib/model-presets/plan.js');

function openAiStatus(overrides: { loggedIn?: boolean; hasOpenAIApiKey?: boolean } = {}) {
  return { installed: false, loggedIn: false, expired: false, authMode: null, accountId: null, lastRefresh: null, accessTokenExpiresAt: null, hasOpenAIApiKey: false, bridgedFromCodex: false, ...overrides };
}

beforeEach(() => {
  mocks.getOpenAIAuthStatus.mockReset();
  mocks.loadConfigNoMigration.mockReset();
  mocks.loadConfigNoMigration.mockResolvedValue({ config: { apiKeys: {} } });
});

describe('default OpenAI credential check', () => {
  it('reports no credentials without a Codex sign-in, a Codex/env API key or a configured key', async () => {
    mocks.getOpenAIAuthStatus.mockResolvedValue(openAiStatus());
    expect(await defaultPresetPlanDeps.hasCredentials('openai')).toBe(false);
  });

  it('accepts a Codex sign-in, an OpenAI API key, or a configured api_keys.openai', async () => {
    mocks.getOpenAIAuthStatus.mockResolvedValue(openAiStatus({ loggedIn: true }));
    expect(await defaultPresetPlanDeps.hasCredentials('openai')).toBe(true);
    mocks.getOpenAIAuthStatus.mockResolvedValue(openAiStatus({ hasOpenAIApiKey: true }));
    expect(await defaultPresetPlanDeps.hasCredentials('openai')).toBe(true);
    mocks.getOpenAIAuthStatus.mockResolvedValue(openAiStatus());
    mocks.loadConfigNoMigration.mockResolvedValue({ config: { apiKeys: { openai: 'resolved-key' } } });
    expect(await defaultPresetPlanDeps.hasCredentials('openai')).toBe(true);
  });

  it('blocks the OpenAI plan with zero change rows when nothing is configured', async () => {
    mocks.getOpenAIAuthStatus.mockResolvedValue(openAiStatus());
    const plan = await planPresetApply('openai', {
      ...defaultPresetPlanDeps,
      readConfigText: async () => '',
      resolveHarnessBinary: async () => '/usr/bin/codex',
      getAuthMode: async () => 'api-key',
      resolveCodexContext: async () => ({}),
    });
    expect(plan.blocked?.reason).toBe('OpenAI has no credentials. Sign in (codex login) or set an API key in Settings → Providers.');
    expect(plan.rows.filter((row) => row.status === 'change')).toEqual([]);
  });
});
