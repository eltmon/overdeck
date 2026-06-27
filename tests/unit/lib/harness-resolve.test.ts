import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeName } from '../../../src/lib/runtimes/types.js';

const mocks = vi.hoisted(() => ({
  loadConfigSync: vi.fn(),
  canUseHarnessSync: vi.fn(),
  getProviderAuthMode: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('../../../src/lib/config-yaml.js', () => ({
  loadConfigSync: mocks.loadConfigSync,
}));

vi.mock('../../../src/lib/harness-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/harness-policy.js')>();
  return {
    ...actual,
    canUseHarnessSync: mocks.canUseHarnessSync,
  };
});

vi.mock('../../../src/lib/agents.js', () => ({
  getProviderAuthMode: mocks.getProviderAuthMode,
}));

vi.mock('child_process', () => ({
  exec: mocks.exec,
}));

function setConfig(config: { roles?: Record<string, { harness?: RuntimeName }>; providerHarnesses?: Record<string, RuntimeName> }) {
  mocks.loadConfigSync.mockReturnValue({
    config: {
      roles: config.roles ?? {},
      providerHarnesses: config.providerHarnesses ?? {},
    },
  });
}

function setBinaryAvailable(available: boolean) {
  mocks.exec.mockImplementation((_command: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (typeof callback !== 'function') return {} as never;
    if (available) {
      callback(null, '/usr/bin/harness\n', '');
    } else {
      callback(new Error('not found'), '', '');
    }
    return {} as never;
  });
}

async function loadSubject() {
  return import('../../../src/lib/harness-resolve.js');
}

describe('resolveHarness', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setConfig({});
    setBinaryAvailable(true);
    mocks.getProviderAuthMode.mockResolvedValue(undefined);
    mocks.canUseHarnessSync.mockReturnValue({ allowed: true });
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('is provider-default-only (PAN-1984): ignores explicit and role; provider config then built-in default wins', async () => {
    const { resolveHarness } = await loadSubject();

    // Both the explicit per-spawn harness AND the per-role harness are ignored —
    // the per-provider configured default (openai → codex) wins regardless.
    setConfig({ roles: { work: { harness: 'ohmypi' } }, providerHarnesses: { openai: 'codex' } });
    await expect(resolveHarness({ explicit: 'claude-code', role: 'work', model: 'gpt-5.5' })).resolves.toBe('codex');
    await expect(resolveHarness({ role: 'work', model: 'gpt-5.5' })).resolves.toBe('codex');

    // A different per-provider default still wins over any explicit input.
    setConfig({ providerHarnesses: { openai: 'ohmypi' } });
    await expect(resolveHarness({ explicit: 'claude-code', model: 'gpt-5.5' })).resolves.toBe('ohmypi');

    // No config → built-in provider default.
    setConfig({});
    await expect(resolveHarness({ model: 'gpt-5.5' })).resolves.toBe('codex');
  });

  it('uses built-in defaults for Anthropic, OpenAI, Kimi, Google, and Z.AI models', async () => {
    const { resolveHarness } = await loadSubject();
    setConfig({});

    await expect(resolveHarness({ model: 'claude-sonnet-4-6' })).resolves.toBe('claude-code');
    await expect(resolveHarness({ model: 'gpt-5.5' })).resolves.toBe('codex');
    await expect(resolveHarness({ model: 'kimi-k2.6' })).resolves.toBe('claude-code');
    await expect(resolveHarness({ model: 'gemini-3.1-pro-preview' })).resolves.toBe('ohmypi');
    await expect(resolveHarness({ model: 'glm-5.1' })).resolves.toBe('ohmypi');
  });

  it('passes the resolved provider-default winner through the harness policy gate', async () => {
    mocks.getProviderAuthMode.mockResolvedValue('subscription');
    mocks.canUseHarnessSync.mockReturnValue({ allowed: false, reason: 'blocked' });
    const { resolveHarness } = await loadSubject();

    // claude-sonnet-4-6 → provider default claude-code; the gate denies it and it cannot
    // fall back to itself, so resolution throws. An ignored explicit 'ohmypi' does not change
    // which harness is gated.
    await expect(resolveHarness({ explicit: 'ohmypi', model: 'claude-sonnet-4-6' })).rejects.toThrow('blocked');

    expect(mocks.canUseHarnessSync).toHaveBeenCalledWith('claude-code', 'claude-sonnet-4-6', 'subscription');
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it('falls back to claude-code when a native model’s provider-default harness is policy-denied (only after checking the fallback)', async () => {
    mocks.getProviderAuthMode.mockResolvedValue('subscription');
    mocks.canUseHarnessSync
      .mockReturnValueOnce({ allowed: false, reason: 'pi denied' })
      .mockReturnValueOnce({ allowed: true });
    // anthropic's per-provider default is set to pi; pi is denied → since claude-code is
    // anthropic's NATIVE harness, falling back to it is safe.
    setConfig({ providerHarnesses: { anthropic: 'ohmypi' } });
    const { resolveHarness } = await loadSubject();

    await expect(resolveHarness({ model: 'claude-sonnet-4-6' })).resolves.toBe('claude-code');

    expect(mocks.canUseHarnessSync).toHaveBeenNthCalledWith(1, 'ohmypi', 'claude-sonnet-4-6', 'subscription');
    expect(mocks.canUseHarnessSync).toHaveBeenNthCalledWith(2, 'claude-code', 'claude-sonnet-4-6', 'subscription');
    expect(warnSpy).toHaveBeenCalledWith('harness ohmypi denied for anthropic: pi denied — falling back to native claude-code');
  });

  it('does not fall back when the model itself is denied by auth policy', async () => {
    mocks.getProviderAuthMode.mockResolvedValue('api-key');
    const { resolveHarness } = await loadSubject();

    await expect(resolveHarness({ model: 'gpt-5.5' })).rejects.toThrow('GPT-5.5 needs a ChatGPT/Codex subscription sign-in');

    expect(mocks.canUseHarnessSync).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it('refuses to silently fall back to claude-code when a non-native model’s harness binary is missing (PAN-1871)', async () => {
    setBinaryAvailable(false);
    const { resolveHarness } = await loadSubject();
    setConfig({});

    // gpt-5.5 routes through codex (a CLIProxy/non-native model); a missing codex
    // binary must fail loudly rather than degrade onto claude-code/CLIProxy.
    await expect(resolveHarness({ model: 'gpt-5.5' })).rejects.toThrow('has no installed codex binary at spawn');

    expect(mocks.exec).toHaveBeenCalledWith('command -v codex', expect.any(Function));
  });

  it('logs the built-in provider-default notice once per provider', async () => {
    const { resolveHarness } = await loadSubject();
    setConfig({});

    await resolveHarness({ model: 'gpt-5.5' });
    await resolveHarness({ model: 'gpt-5.4' });
    await resolveHarness({ model: 'kimi-k2.6' });

    expect(infoSpy).toHaveBeenCalledTimes(2);
    expect(infoSpy).toHaveBeenNthCalledWith(1, 'harness codex chosen by provider default — override in Settings → Providers');
    expect(infoSpy).toHaveBeenNthCalledWith(2, 'harness claude-code chosen by provider default — override in Settings → Providers');
  });
});
