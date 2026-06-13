import { describe, expect, it, vi, beforeEach } from 'vitest';

const policyMocks = vi.hoisted(() => ({
  canUseHarnessSync: vi.fn(),
  canUseModelWithAuthSync: vi.fn(() => ({ allowed: true })),
}));
const providerMocks = vi.hoisted(() => ({
  getBuiltInDefaultHarness: vi.fn(),
  getProviderForModelSync: vi.fn(),
}));
const configMock = vi.hoisted(() => ({ loadConfigSync: vi.fn(() => ({ config: {} })) }));

vi.mock('../harness-policy.js', () => ({
  canUseHarnessSync: policyMocks.canUseHarnessSync,
  canUseModelWithAuthSync: policyMocks.canUseModelWithAuthSync,
}));
vi.mock('../providers.js', () => ({
  getBuiltInDefaultHarness: providerMocks.getBuiltInDefaultHarness,
  getProviderForModelSync: providerMocks.getProviderForModelSync,
}));
vi.mock('../config-yaml.js', () => ({ loadConfigSync: configMock.loadConfigSync }));
vi.mock('../agents.js', () => ({ getProviderAuthMode: vi.fn(async () => 'apikey') }));

describe('resolveHarness — PAN-1871: no silent CLIProxy fallback for non-native models', () => {
  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    policyMocks.canUseModelWithAuthSync.mockReturnValue({ allowed: true });
    configMock.loadConfigSync.mockReturnValue({ config: {} });
    const { resetHarnessResolveCachesForTests } = await import('../harness-resolve.js');
    resetHarnessResolveCachesForTests();
  });

  it('throws instead of silently using claude-code when pi is denied for a non-native (CLIProxy) model', async () => {
    // kimi → provider default pi; claude-code would route via CLIProxy (200k deadlock).
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'moonshot' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('pi');
    policyMocks.canUseHarnessSync.mockImplementation((h: string) =>
      h === 'pi' ? { allowed: false, reason: 'pi denied' } : { allowed: true });

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model: 'kimi-k2.7-code', role: 'work' }))
      .rejects.toThrow(/not native to claude-code/);
  });

  it('still falls back to claude-code when a native (Anthropic) model has its resolved harness denied', async () => {
    // claude model with a role override to pi; pi denied → fallback to native claude-code is safe.
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'anthropic' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('claude-code');
    configMock.loadConfigSync.mockReturnValue({ config: { roles: { work: { harness: 'pi' } } } });
    policyMocks.canUseHarnessSync.mockImplementation((h: string) =>
      h === 'claude-code' ? { allowed: true } : { allowed: false, reason: 'pi denied' });

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model: 'claude-sonnet-4-6', role: 'work' })).resolves.toBe('claude-code');
  });
});
