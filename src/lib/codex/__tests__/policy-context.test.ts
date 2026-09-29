import { describe, expect, it, vi } from 'vitest';
import { resolveCodexPolicyContext } from '../policy-context.js';

describe('resolveCodexPolicyContext (PAN-4363)', () => {
  it('returns the installed version for a floored model under subscription auth', async () => {
    const readVersion = vi.fn(async () => '0.153.4');
    const resolveBinary = vi.fn(async () => '/usr/local/bin/codex');
    const context = await resolveCodexPolicyContext('codex', 'gpt-6-luna', 'subscription', { resolveBinary, readVersion });
    expect(context).toEqual({ codexCliVersion: '0.153.4' });
  });

  it('returns {} without calling readVersion for a model without a floor', async () => {
    const readVersion = vi.fn(async () => '0.153.4');
    const resolveBinary = vi.fn(async () => '/usr/local/bin/codex');
    const context = await resolveCodexPolicyContext('codex', 'gpt-6-astra', 'subscription', { resolveBinary, readVersion });
    expect(context).toEqual({});
    expect(readVersion).not.toHaveBeenCalled();
    expect(resolveBinary).not.toHaveBeenCalled();
  });

  it('returns {} without calling readVersion for api-key auth', async () => {
    const readVersion = vi.fn(async () => '0.153.4');
    const resolveBinary = vi.fn(async () => '/usr/local/bin/codex');
    const context = await resolveCodexPolicyContext('codex', 'gpt-6-luna', 'api-key', { resolveBinary, readVersion });
    expect(context).toEqual({});
    expect(readVersion).not.toHaveBeenCalled();
    expect(resolveBinary).not.toHaveBeenCalled();
  });

  it('returns {} without calling readVersion for the claude-code harness', async () => {
    const readVersion = vi.fn(async () => '0.153.4');
    const resolveBinary = vi.fn(async () => '/usr/local/bin/codex');
    const context = await resolveCodexPolicyContext('claude-code', 'gpt-6-luna', 'subscription', { resolveBinary, readVersion });
    expect(context).toEqual({});
    expect(readVersion).not.toHaveBeenCalled();
    expect(resolveBinary).not.toHaveBeenCalled();
  });

  it('returns {} when the binary cannot be resolved', async () => {
    const readVersion = vi.fn(async () => '0.153.4');
    const resolveBinary = vi.fn(async () => null);
    const context = await resolveCodexPolicyContext('codex', 'gpt-6-luna', 'subscription', { resolveBinary, readVersion });
    expect(context).toEqual({});
    expect(readVersion).not.toHaveBeenCalled();
  });

  it('returns {} when the version cannot be read', async () => {
    const readVersion = vi.fn(async () => undefined);
    const resolveBinary = vi.fn(async () => '/usr/local/bin/codex');
    const context = await resolveCodexPolicyContext('codex', 'gpt-6-luna', 'subscription', { resolveBinary, readVersion });
    expect(context).toEqual({});
  });
});
