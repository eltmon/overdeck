/**
 * PAN-4843 W-5: `GET /api/push/status` reports the Overdeck app's phones and
 * directory state, and the native provider is the third default provider.
 * Kept apart from needs-you-push-service.test.ts so these module mocks do not
 * reach its cases (PRD H-3).
 */
import { describe, expect, it, vi } from 'vitest';

const directory = vi.hoisted(() => ({ client: null as { isOnline: () => boolean } | null }));

vi.mock('../../../../lib/config-yaml.js', async () => {
  const { defaultPushConfig } = await import('../../../../lib/config-yaml/push-config.js');
  return { loadConfigSync: () => ({ config: { push: defaultPushConfig() } }) };
});
vi.mock('../../../../lib/push/subscription-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/push/subscription-store.js')>()),
  listPushSubscriptions: async () => [],
}));
vi.mock('../directory-client.js', () => ({ currentDirectoryClient: () => directory.client }));
vi.mock('../../../../lib/push/native-provider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/push/native-provider.js')>()),
  nativePushPhones: () => [{ clientId: 'c1', pushKey: 'a'.repeat(64) }, { clientId: 'c2', pushKey: 'b'.repeat(64) }],
}));

const { defaultProviders, getNeedsYouPushStatus } = await import('../needs-you-push-service.js');

describe('needs-you push status: Overdeck app (PAN-4843)', () => {
  it('counts phones with a push key and reports the directory online', async () => {
    directory.client = { isOnline: () => true };
    expect((await getNeedsYouPushStatus()).native).toEqual({ phones: 2, directoryOnline: true });
  });

  it('reports the directory offline when there is no directory client', async () => {
    directory.client = null;
    expect((await getNeedsYouPushStatus()).native).toEqual({ phones: 2, directoryOnline: false });
  });

  it('lists the native provider third', () => {
    expect(defaultProviders().map((provider) => provider.name)).toEqual(['webpush', 'ntfy', 'native']);
  });
});
