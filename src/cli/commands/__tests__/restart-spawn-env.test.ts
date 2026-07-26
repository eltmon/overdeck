/**
 * PAN-2989: `scrubAgentIdentityFromDashboardEnv` keeps the spawned dashboard
 * server from inheriting the spawner's agent identity. Deploy-patrol exports
 * OVERDECK_AGENT_ID=deploy-patrol on its `pan reload` child; before this scrub
 * the restarted server inherited it and every record-lock owner string
 * misattributed server writes to deploy-patrol.
 */

import { describe, expect, it } from 'vitest';

import { scrubAgentIdentityFromDashboardEnv } from '../restart.js';

describe('scrubAgentIdentityFromDashboardEnv (PAN-2989)', () => {
  it('relocates an inherited OVERDECK_AGENT_ID to OVERDECK_DASHBOARD_SPAWNED_BY and deletes the identity vars', () => {
    const env: NodeJS.ProcessEnv = {
      OVERDECK_AGENT_ID: 'deploy-patrol',
      OVERDECK_ISSUE_ID: 'PAN-806',
      OVERDECK_SESSION_TYPE: 'patrol',
      PATH: '/usr/bin',
    };

    scrubAgentIdentityFromDashboardEnv(env);

    expect(env.OVERDECK_DASHBOARD_SPAWNED_BY).toBe('deploy-patrol');
    expect(env.OVERDECK_AGENT_ID).toBeUndefined();
    expect(env.OVERDECK_ISSUE_ID).toBeUndefined();
    expect(env.OVERDECK_SESSION_TYPE).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  it('leaves OVERDECK_DASHBOARD_SPAWNED_BY absent when no identity was inherited', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };

    scrubAgentIdentityFromDashboardEnv(env);

    expect('OVERDECK_DASHBOARD_SPAWNED_BY' in env).toBe(false);
    expect(env.OVERDECK_AGENT_ID).toBeUndefined();
  });

  it('strips launcher git-guard shim dirs from PATH so the server runs real git', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/home/u/.overdeck/agents/agent-pan-1/git-guard:/usr/bin:/home/u/.overdeck/agents/conv-2/git-guard:/bin',
    };

    scrubAgentIdentityFromDashboardEnv(env);

    expect(env.PATH).toBe('/usr/bin:/bin');
  });

  it('deletes stale issue/session identity even without an agent id', () => {
    const env: NodeJS.ProcessEnv = {
      OVERDECK_ISSUE_ID: 'PAN-2989',
      OVERDECK_SESSION_TYPE: 'work',
    };

    scrubAgentIdentityFromDashboardEnv(env);

    expect('OVERDECK_DASHBOARD_SPAWNED_BY' in env).toBe(false);
    expect(env.OVERDECK_ISSUE_ID).toBeUndefined();
    expect(env.OVERDECK_SESSION_TYPE).toBeUndefined();
  });
});
