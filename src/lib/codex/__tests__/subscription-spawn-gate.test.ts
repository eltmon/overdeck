import { describe, expect, it, vi } from 'vitest';

import type { CodexAuthStatus } from '../../codex-auth.js';
import { codexSubscriptionSpawnBlock, spawnUsesCodexSubscription } from '../subscription-spawn-gate.js';

const BURNED: CodexAuthStatus = {
  status: 'burned', email: 'user@example.com', expiresAt: '', source: 'native', affectedAgents: ['conv-20261118-427e'],
};

describe('codexSubscriptionSpawnBlock (PAN-5633)', () => {
  it('lets an Anthropic-subscription spawn proceed while a live Codex session is burned, without checking', async () => {
    const checkStatus = vi.fn(async () => BURNED);
    await expect(codexSubscriptionSpawnBlock('claude-opus-5-5', 'subscription', { checkStatus })).resolves.toBeNull();
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it('refuses a GPT-subscription spawn while the Codex sign-in is burned', async () => {
    await expect(codexSubscriptionSpawnBlock('gpt-5.6-sol', 'subscription', { checkStatus: async () => BURNED }))
      .resolves.toMatchObject({ status: 'burned', affectedAgents: ['conv-20261118-427e'] });
  });

  it('refuses a GPT-subscription spawn while the Codex sign-in is expired', async () => {
    const expired: CodexAuthStatus = { status: 'expired', email: '', expiresAt: '' };
    await expect(codexSubscriptionSpawnBlock('gpt-5.6-sol', 'subscription', { checkStatus: async () => expired }))
      .resolves.toMatchObject({ status: 'expired' });
  });

  it('lets a GPT-subscription spawn proceed while the Codex sign-in is valid', async () => {
    const valid: CodexAuthStatus = { status: 'valid', email: '', expiresAt: '' };
    await expect(codexSubscriptionSpawnBlock('gpt-5.6-sol', 'subscription', { checkStatus: async () => valid })).resolves.toBeNull();
  });

  it('does not check a GPT spawn on API-key auth', async () => {
    const checkStatus = vi.fn(async () => BURNED);
    await expect(codexSubscriptionSpawnBlock('gpt-5.6-sol', 'api-key', { checkStatus })).resolves.toBeNull();
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it('spawnUsesCodexSubscription is true only for an OpenAI model on a subscription', () => {
    expect(spawnUsesCodexSubscription('gpt-5.6-sol', 'subscription')).toBe(true);
    expect(spawnUsesCodexSubscription('claude-opus-5-5', 'subscription')).toBe(false);
    expect(spawnUsesCodexSubscription('gpt-5.6-sol', undefined)).toBe(false);
  });
});
