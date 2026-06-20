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
    // anthropic model with a per-provider default of pi; pi denied → fallback to native
    // claude-code is safe (claude-code IS anthropic's native harness).
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'anthropic' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('claude-code');
    configMock.loadConfigSync.mockReturnValue({ config: { providerHarnesses: { anthropic: 'pi' } } });
    policyMocks.canUseHarnessSync.mockImplementation((h: string) =>
      h === 'claude-code' ? { allowed: true } : { allowed: false, reason: 'pi denied' });

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model: 'claude-sonnet-4-6' })).resolves.toBe('claude-code');
  });
});

describe('resolveHarness — PAN-1984: provider-default-only (explicit/role overrides ignored)', () => {
  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    policyMocks.canUseModelWithAuthSync.mockReturnValue({ allowed: true });
    policyMocks.canUseHarnessSync.mockReturnValue({ allowed: true });
    configMock.loadConfigSync.mockReturnValue({ config: {} });
    const { resetHarnessResolveCachesForTests } = await import('../harness-resolve.js');
    resetHarnessResolveCachesForTests();
  });

  it('ignores a per-role harness override — the provider default wins', async () => {
    // anthropic model, provider default claude-code, role config tries to force pi.
    // Provider-default-only: the role harness is ignored, harness follows the provider.
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'anthropic' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('claude-code');
    configMock.loadConfigSync.mockReturnValue({ config: { roles: { work: { harness: 'pi' } } } });

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model: 'claude-sonnet-4-6', role: 'work' })).resolves.toBe('claude-code');
  });

  it('ignores an explicit per-spawn harness override — the provider default wins', async () => {
    // The operator "picked pi" at spawn for an anthropic model; provider-default-only
    // discards it. (This is exactly the Pi+GPT-5.5-when-Codex-was-meant class of bug.)
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'anthropic' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('claude-code');
    configMock.loadConfigSync.mockReturnValue({ config: {} });

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model: 'claude-sonnet-4-6', explicit: 'pi' })).resolves.toBe('claude-code');
  });

  it('uses the per-provider configured default when set (Settings → Providers)', async () => {
    // anthropic provider explicitly configured to claude-code; resolves there regardless
    // of any role/explicit input.
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'anthropic' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('claude-code');
    configMock.loadConfigSync.mockReturnValue({ config: { providerHarnesses: { anthropic: 'claude-code' } } });

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model: 'claude-sonnet-4-6', explicit: 'pi', role: 'work' })).resolves.toBe('claude-code');
  });
});
