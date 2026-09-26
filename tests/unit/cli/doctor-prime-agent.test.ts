/**
 * PAN-3668 WI-20 (FR-4, FR-25): `pan doctor` reports the Prime Agent version against
 * the supported range and lists orphaned Overdeck-owned Prime daemons.
 */
import { describe, expect, it, vi } from 'vitest';

import { checkPrimeAgent } from '../../../src/cli/commands/doctor-prime-agent.js';

const binary = async () => '/usr/bin/prime-agent';
const noOrphans = async () => [];

describe('checkPrimeAgent (PAN-3668 WI-20)', () => {
  it('warns, and does not fail, when Prime Agent is not installed', async () => {
    const listOrphans = vi.fn(noOrphans);
    await expect(checkPrimeAgent({ resolveBinary: async () => null, listOrphans })).resolves.toEqual([{
      name: 'Prime Agent',
      status: 'warn',
      message: 'Not installed (optional Prime Agent harness)',
      fix: 'Install: npm install -g prime-agent@0.8',
    }]);
    expect(listOrphans).not.toHaveBeenCalled();
  });

  it('errors for 0.7.2, naming the found version and the supported range', async () => {
    const [result] = await checkPrimeAgent({ resolveBinary: binary, readVersion: async () => '\n0.7.2\n', listOrphans: noOrphans });
    expect(result).toMatchObject({ name: 'Prime Agent', status: 'error', fix: 'Install: npm install -g prime-agent@0.8' });
    expect(result!.message).toContain('Prime Agent 0.7.2 is outside the supported range 0.8.0 – <0.9.0');
  });

  it('is ok for 0.8.0 read from stderr-style output', async () => {
    await expect(checkPrimeAgent({ resolveBinary: binary, readVersion: async () => '\n0.8.0\n', listOrphans: noOrphans })).resolves.toEqual([
      { name: 'Prime Agent', status: 'ok', message: '0.8.0 (supported 0.8.0 – <0.9.0)' },
    ]);
  });

  it('warns once per orphaned daemon with the process-group kill as the fix', async () => {
    const results = await checkPrimeAgent({
      resolveBinary: binary,
      readVersion: async () => '0.8.0',
      listOrphans: async () => [{ socketPath: '/home/op/.overdeck/sockets/pd-0123456789abcdef.sock', pid: 4242 }],
    });
    expect(results).toHaveLength(2);
    expect(results[1]).toEqual({
      name: 'Prime Agent daemon',
      status: 'warn',
      message: 'Orphaned Overdeck Prime Agent daemon on /home/op/.overdeck/sockets/pd-0123456789abcdef.sock (pid 4242); its agent or conversation is gone',
      fix: 'kill -TERM -- -4242',
    });
  });
});
