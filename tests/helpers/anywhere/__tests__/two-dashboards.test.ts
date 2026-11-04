/** PAN-4774 WI-3: the pure parts of the two-dashboard harness. */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPreconditions, buildServerEnv, removeTestHome } from '../two-dashboards.js';

const BASE: NodeJS.ProcessEnv = {
  PATH: '/home/u/.nvm/bin:/usr/bin',
  HOME: '/home/u',
  VITEST_POOL_ID: '3',
  VITEST: 'true',
  HOST: '127.0.0.1',
  SHELL: '/bin/zsh',
  NODE_ENV: 'test',
  OVERDECK_INTERNAL_TOKEN: 'secret',
  OVERDECK_AGENT_ID: 'agent-pan-1',
  OVERDECK_DASHBOARD_SPAWNED_BY: 'x',
  DASHBOARD_URL: 'http://127.0.0.1:3011',
  KEEP_ME: 'yes',
};

describe('buildServerEnv (PAN-4774 WI-3)', () => {
  it('ac1: scrubs inherited keys and sets the peer-mode tmux env', () => {
    const env = buildServerEnv(BASE, { machine: 'b', home: '/tmp/odk-b-1', port: 4100, pid: 77 });
    for (const key of ['VITEST_POOL_ID', 'VITEST', 'HOST', 'SHELL', 'NODE_ENV', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_AGENT_ID', 'OVERDECK_DASHBOARD_SPAWNED_BY']) {
      expect(env).not.toHaveProperty(key);
    }
    expect(env).toMatchObject({
      KEEP_ME: 'yes',
      HOME: '/tmp/odk-b-1/fakehome',
      PATH: '/tmp/odk-b-1/bin:/usr/local/bin:/usr/bin:/bin',
      OVERDECK_HOME: '/tmp/odk-b-1',
      API_PORT: '4100',
      PORT: '4100',
      OVERDECK_DASHBOARD_URL: 'http://127.0.0.1:4100',
      DASHBOARD_URL: 'http://127.0.0.1:4100',
      OVERDECK_TERMINAL_BACKEND: 'tmux',
      OVERDECK_TMUX_SOCKET_NAME: 'odk-b-77',
      OVERDECK_DISABLE_DEACON: '1',
      OVERDECK_ANYWHERE_SUPERVISOR: '1',
      OVERDECK_NO_RESUME: '1',
    });
  });

  it('ac2: sets the adopt hook on A only', () => {
    expect(buildServerEnv(BASE, { machine: 'a', home: '/tmp/odk-a-1', port: 4101 })['OVERDECK_TEST_ADOPT_SKIP_SAVED_CWD']).toBe('1');
    expect(buildServerEnv(BASE, { machine: 'b', home: '/tmp/odk-b-1', port: 4102 })).not.toHaveProperty('OVERDECK_TEST_ADOPT_SKIP_SAVED_CWD');
  });
});

describe('assertPreconditions (PAN-4774 WI-3)', () => {
  it('ac3: throws on a missing build and on missing tmux, never skips', () => {
    expect(() => assertPreconditions({ serverPath: '/nonexistent/dist/dashboard/server.js', hasTmux: true })).toThrow(/npm run build/);
    expect(() => assertPreconditions({ serverPath: __filename, hasTmux: false })).toThrow(/install tmux/);
    expect(() => assertPreconditions({ serverPath: __filename, hasTmux: true })).not.toThrow();
  });
});

describe('removeTestHome (PAN-4774 WI-3)', () => {
  it('ac4: refuses paths outside tmpdir or without the odk- prefix, removes an odk- home', () => {
    expect(() => removeTestHome('/home/runner')).toThrow(/refusing/);
    const other = mkdtempSync(join(tmpdir(), 'pan-not-odk-'));
    try {
      expect(() => removeTestHome(other)).toThrow(/refusing/);
      expect(existsSync(other)).toBe(true);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
    const nested = mkdtempSync(join(tmpdir(), 'odk-outer-'));
    mkdirSync(join(nested, 'odk-inner'));
    expect(() => removeTestHome(join(nested, 'odk-inner'))).toThrow(/refusing/);
    removeTestHome(nested);
    expect(existsSync(nested)).toBe(false);
  });
});
