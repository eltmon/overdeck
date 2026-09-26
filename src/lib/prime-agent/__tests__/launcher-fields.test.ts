import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolvePrimeAgentCredential = vi.fn();

vi.mock('../provider-map.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../provider-map.js')>()),
  resolvePrimeAgentCredential,
}));

const { getPrimeAgentLauncherFields } = await import('../launcher-fields.js');

describe('getPrimeAgentLauncherFields (PAN-3668 WI-12)', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-prime-fields-'));
    prevHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
    resolvePrimeAgentCredential.mockReset();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('builds host fields for an OpenAI model and keeps the credential out of the launcher fields', async () => {
    resolvePrimeAgentCredential.mockResolvedValue({ provider: 'openai', envExports: { OPENAI_API_KEY: 'sk-test' } });
    const workspace = join(home, 'ws');

    const { fields, paneEnv } = await getPrimeAgentLauncherFields('agent-pan-9', 'gpt-5.4', workspace, '/usr/bin/prime-agent', { authMode: 'api-key', effort: 'high' });

    expect(fields).toEqual({
      harness: 'prime-agent',
      primeAgent: {
        agentId: 'agent-pan-9',
        binaryPath: '/usr/bin/prime-agent',
        provider: 'openai',
        workspace,
        contextFile: join(home, 'agents', 'agent-pan-9', 'prime-agent-context.md'),
        thinking: 'high',
      },
      model: 'gpt-5.4',
      unsetProviderEnv: true,
      preserveProviderEnv: ['OPENAI_API_KEY'],
    });
    expect(JSON.stringify(fields)).not.toContain('sk-test');
    expect(paneEnv).toEqual({ OPENAI_API_KEY: 'sk-test' });
    expect(existsSync(fields.primeAgent.contextFile)).toBe(true);
    expect(resolvePrimeAgentCredential).toHaveBeenCalledWith('gpt-5.4', 'api-key');
  });

  it('passes the resume session file through and drops an effort Prime does not accept', async () => {
    resolvePrimeAgentCredential.mockResolvedValue({ provider: 'kimi-coding', envExports: {} });

    const { fields } = await getPrimeAgentLauncherFields('agent-pan-9', 'k3', join(home, 'ws'), '/usr/bin/prime-agent', {
      authMode: undefined,
      effort: 'ultra',
      resumeSessionFile: '/x/prime-sessions/s.jsonl',
    });

    expect(fields.primeAgent.thinking).toBeUndefined();
    expect(fields.primeAgent.resumeSessionFile).toBe('/x/prime-sessions/s.jsonl');
    expect(fields.preserveProviderEnv).toEqual([]);
  });

  it('propagates a credential error without materializing context', async () => {
    resolvePrimeAgentCredential.mockRejectedValue(new Error('no credential for Prime provider "openai"'));

    await expect(getPrimeAgentLauncherFields('agent-pan-9', 'gpt-5.4', join(home, 'ws'), '/usr/bin/prime-agent', { authMode: 'api-key' }))
      .rejects.toThrow('no credential for Prime provider "openai"');
    expect(existsSync(join(home, 'agents', 'agent-pan-9', 'prime-agent-context.md'))).toBe(false);
  });
});
