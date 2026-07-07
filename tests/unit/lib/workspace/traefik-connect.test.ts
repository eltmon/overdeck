import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[][] = [];
let responses: Record<string, string | Error>;

vi.mock('node:child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    calls.push([cmd, ...args]);
    const key = args.join(' ');
    const match = Object.entries(responses).find(([k]) => key.startsWith(k));
    if (!match) return cb(null, { stdout: '', stderr: '' });
    const value = match[1];
    if (value instanceof Error) return cb(value, { stdout: '', stderr: '' });
    return cb(null, { stdout: value, stderr: '' });
  },
}));

import { reconcileTraefikNetworks } from '../../../../src/lib/workspace/traefik-connect.js';

describe('reconcileTraefikNetworks (PAN-2428)', () => {
  beforeEach(() => {
    calls.length = 0;
    responses = {};
  });

  it('connects traefik to a populated workspace network it is missing', async () => {
    responses = {
      'ps --filter name=overdeck-traefik': 'overdeck-traefik\n',
      'inspect overdeck-traefik': 'bridge\novderdeck\n',
      'network ls': 'bridge\nmyn-feature-min-862_devnet\nmyn-feature-min-857_devnet\n',
      'network inspect myn-feature-min-862_devnet': '4\n',
      'network inspect myn-feature-min-857_devnet': '4\n',
    };
    const actions = await reconcileTraefikNetworks();
    expect(actions).toHaveLength(2);
    expect(calls).toContainEqual(['docker', 'network', 'connect', 'myn-feature-min-862_devnet', 'overdeck-traefik']);
    expect(calls).toContainEqual(['docker', 'network', 'connect', 'myn-feature-min-857_devnet', 'overdeck-traefik']);
  });

  it('skips networks traefik is already on and empty networks', async () => {
    responses = {
      'ps --filter name=overdeck-traefik': 'overdeck-traefik\n',
      'inspect overdeck-traefik': 'bridge\nmyn-feature-min-857_devnet\n',
      'network ls': 'myn-feature-min-857_devnet\nmyn-feature-min-999_devnet\n',
      'network inspect myn-feature-min-999_devnet': '0\n',
    };
    const actions = await reconcileTraefikNetworks();
    expect(actions).toHaveLength(0);
    expect(calls.some(c => c[1] === 'network' && c[2] === 'connect')).toBe(false);
  });

  it('ignores non-workspace networks', async () => {
    responses = {
      'ps --filter name=overdeck-traefik': 'overdeck-traefik\n',
      'inspect overdeck-traefik': 'bridge\n',
      'network ls': 'bridge\nhost\nnone\nmyn-main_devnet\nsomething_default\n',
    };
    const actions = await reconcileTraefikNetworks();
    expect(actions).toHaveLength(0);
  });

  it('is a no-op when traefik is not running', async () => {
    responses = {
      'ps --filter name=overdeck-traefik': '',
    };
    const actions = await reconcileTraefikNetworks();
    expect(actions).toHaveLength(0);
    expect(calls.filter(c => c[1] === 'network')).toHaveLength(0);
  });
});
