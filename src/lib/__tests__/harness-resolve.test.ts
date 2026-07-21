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
const binaryMocks = vi.hoisted(() => ({
  available: new Set(['omp', 'codex', 'kimi']),
  availablePaths: new Set<string>(),
  resolutions: [] as Array<{ harness: string; executablePath?: string }>,
}));

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

beforeEach(() => {
  binaryMocks.available.clear();
  binaryMocks.available.add('omp');
  binaryMocks.available.add('codex');
  binaryMocks.available.add('kimi');
  binaryMocks.availablePaths.clear();
  binaryMocks.resolutions.length = 0;
});

// Control shared harness-binary resolution so binary-gated harnesses can be
// tested without depending on the developer machine's installed CLIs.
vi.mock('../harness-binary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../harness-binary.js')>();
  return {
    ...actual,
    resolveHarnessBinary: vi.fn(async (harness, options) => {
      const executablePath = options?.executablePath;
      binaryMocks.resolutions.push({ harness, executablePath });
      if (executablePath) {
        return binaryMocks.availablePaths.has(executablePath) ? executablePath : null;
      }
      const binary = actual.harnessBinaryName(harness);
      return binaryMocks.available.has(binary) ? `/usr/local/bin/${binary}` : null;
    }),
  };
});

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

  it('fails loudly when Kimi is configured for ACP but the kimi binary is missing', async () => {
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'kimi' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('claude-code');
    configMock.loadConfigSync.mockReturnValue({ config: { providerHarnesses: { kimi: 'acp' } } });
    policyMocks.canUseHarnessSync.mockReturnValue({ allowed: true });
    binaryMocks.available.delete('kimi');

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model: 'kimi-k2.7-code', role: 'work' }))
      .rejects.toThrow(/Harness acp.*no installed kimi binary.*refusing to silently fall back/);
  });

  it('returns ACP when Kimi is configured for ACP and the kimi binary is present', async () => {
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'kimi' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('claude-code');
    configMock.loadConfigSync.mockReturnValue({ config: { providerHarnesses: { kimi: 'acp' } } });
    policyMocks.canUseHarnessSync.mockReturnValue({ allowed: true });

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model: 'kimi-k2.7-code', role: 'work' })).resolves.toBe('acp');
  });

  it('isolates ACP availability cache entries by configured executable path', async () => {
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'kimi' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('claude-code');
    policyMocks.canUseHarnessSync.mockReturnValue({ allowed: true });
    binaryMocks.availablePaths.add('/opt/kimi-a/bin/kimi');
    configMock.loadConfigSync.mockReturnValue({
      config: {
        providerHarnesses: { kimi: 'acp' },
        acp: { kimi: { binaryPath: '/opt/kimi-a/bin/kimi' } },
      },
    });

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model: 'kimi-k2.7-code', role: 'work' })).resolves.toBe('acp');

    configMock.loadConfigSync.mockReturnValue({
      config: {
        providerHarnesses: { kimi: 'acp' },
        acp: { kimi: { binaryPath: '/opt/kimi-b/bin/kimi' } },
      },
    });
    await expect(resolveHarness({ model: 'kimi-k2.7-code', role: 'work' })).rejects.toThrow(
      'Fix the configured executable path /opt/kimi-b/bin/kimi and retry',
    );

    expect(binaryMocks.resolutions).toEqual([
      { harness: 'acp', executablePath: '/opt/kimi-a/bin/kimi' },
      { harness: 'acp', executablePath: '/opt/kimi-b/bin/kimi' },
    ]);
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

  it.each(['k3', 'k3[1m]'])('routes Kimi %s through the claude-code provider default', async (model) => {
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'kimi' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('claude-code');

    const { resolveHarness } = await import('../harness-resolve.js');
    await expect(resolveHarness({ model, role: 'work' })).resolves.toBe('claude-code');
  });

  it('AC(PAN-1989): provider that previously defaulted to pi now resolves to ohmypi via built-in default', async () => {
    // Mechanism test: resolveHarness returns whatever getBuiltInDefaultHarness gives.
    // The built-in default is mocked here, so this exercises the flow-through, not a
    // real provider value. (Kimi's real default has since moved to claude-code —
    // PAN-2102 — but the ohmypi flow-through still holds for google/zai/minimax/etc.)
    providerMocks.getProviderForModelSync.mockReturnValue({ name: 'kimi' });
    providerMocks.getBuiltInDefaultHarness.mockReturnValue('ohmypi');
    configMock.loadConfigSync.mockReturnValue({ config: {} });

    // Mock policy to allow ohmypi (kimi is non-Anthropic, so no ToS block).
    vi.mocked(await import('../harness-policy.js')).canUseHarnessSync = vi.fn(() => ({ allowed: true }));

    const { resolveHarness } = await import('../harness-resolve.js');
    // child_process.exec is mocked above to make `command -v omp` succeed,
    // so hasHarnessBinary('ohmypi') returns true and resolveHarness reaches
    // `return winner` — confirming the built-in default is 'ohmypi', not 'pi'.
    await expect(resolveHarness({ model: 'kimi-k2.7-code' })).resolves.toBe('ohmypi');
  });
});
