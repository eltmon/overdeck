import { describe, expect, it } from 'vitest';

import { buildDashboardHealthResponse } from '../../../src/dashboard/server/health-response.js';
import { getDashboardIdentity } from '../../../src/dashboard/server/identity.js';

describe('dashboard health identity', () => {
  it('identifies the serving process alongside the repository and mode', () => {
    const identity = getDashboardIdentity();

    expect(identity).toMatchObject({
      repoRoot: process.cwd(),
      mode: expect.stringMatching(/^(primary|peer)$/),
    });
    expect(identity.pid).toBe(process.pid);
  });

  it('returns 503 when the on-disk server entrypoint changed after this process started', async () => {
    const processStartedAtMs = 1_000;
    const health = await buildDashboardHealthResponse({
      processStartedAtMs,
      serverPath: '/deploy/generation-a/dist/dashboard/server.js',
      statEntrypoint: async () => ({ mtimeMs: processStartedAtMs + 1 }),
    });

    expect(health.httpStatus).toBe(503);
    expect(health.body).toMatchObject({
      status: 'incoherent',
      deploymentCoherent: false,
      serverPath: '/deploy/generation-a/dist/dashboard/server.js',
      processStartedAtMs,
      serverMtimeMs: processStartedAtMs + 1,
    });
  });

  it('reports healthy when the entrypoint still matches the process generation', async () => {
    const health = await buildDashboardHealthResponse({
      processStartedAtMs: 1_000,
      serverPath: '/deploy/generation-b/dist/dashboard/server.js',
      statEntrypoint: async () => ({ mtimeMs: 999 }),
    });

    expect(health.httpStatus).toBe(200);
    expect(health.body).toMatchObject({
      status: 'ok',
      deploymentCoherent: true,
    });
  });
});
