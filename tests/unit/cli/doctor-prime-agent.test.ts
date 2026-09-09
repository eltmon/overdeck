import { describe, expect, it } from 'vitest';
import { checkPrimeAgent } from '../../../src/cli/commands/doctor-prime-agent.js';

const resolver = async () => '/opt/prime/bin/prime-agent';

describe('checkPrimeAgent', () => {
  it('accepts a compatible release that advertises RPC mode', async () => {
    const result = await checkPrimeAgent(async (_path, args) => args[0] === '--version'
      ? 'prime-agent 0.1.0'
      : 'Usage: prime-agent --mode <interactive|rpc>', resolver);
    expect(result).toEqual([{ name: 'Prime Agent', status: 'ok', message: 'v0.1.0 (RPC mode available)' }]);
  });

  it('returns standalone errors for missing, unsupported, and non-RPC builds', async () => {
    const missing = await checkPrimeAgent(async () => '', async () => null);
    expect(missing[0]).toMatchObject({ status: 'warn', message: expect.stringContaining('Not installed') });

    const unsupported = await checkPrimeAgent(async () => 'prime-agent 1.0.0', resolver);
    expect(unsupported[0]).toMatchObject({ status: 'warn', message: expect.stringContaining('unsupported') });

    const noRpc = await checkPrimeAgent(async (_path, args) => args[0] === '--version' ? '0.1.0' : 'Usage: prime-agent', resolver);
    expect(noRpc[0]).toMatchObject({ status: 'warn', message: expect.stringContaining('--mode rpc') });
  });

  it('reports missing provider credentials', async () => {
    const result = await checkPrimeAgent(async (_path, args) => args[0] === '--version'
      ? 'prime-agent 0.1.0'
      : 'Usage: prime-agent --mode <interactive|rpc>', resolver, async () => false);
    expect(result[1]).toMatchObject({ name: 'Prime Agent provider credentials', status: 'warn' });
  });
});
