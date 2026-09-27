/**
 * PAN-4264 Work Item 27 (NFR-3): no GitHub login, email, hostname, user name,
 * filesystem path or raw user id ever reaches PostHog — with operator
 * grouping on, every captured payload carries only the 16-hex operatorHash.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureMock = vi.hoisted(() => vi.fn());
const postHogConstructorMock = vi.hoisted(() => vi.fn(function PostHogMock() {
  return { capture: captureMock, captureException: vi.fn(), isFeatureEnabled: vi.fn(), shutdown: vi.fn(async () => undefined) };
}));

vi.mock('posthog-node', () => ({ PostHog: postHogConstructorMock }));
vi.mock('../../../../src/lib/telemetry/config.js', () => ({
  resolveTelemetryEnabled: vi.fn(() => true),
  telemetryEnvironmentForcesOff: vi.fn(() => false),
}));
vi.mock('../../../../src/lib/telemetry/install-id.js', () => ({
  getOrCreateInstallId: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
}));
const grouping = vi.hoisted(() => ({ on: true }));
vi.mock('../../../../src/lib/config-yaml.js', () => ({
  loadConfigSync: () => ({ config: { telemetry: { enabled: true, operator_grouping: grouping.on } } }),
}));

import { appendLedgerEntry } from '../../../../src/lib/github-quota/ledger.js';
import { AnalyticsService } from '../../../../src/lib/telemetry/service.js';
import { captureGitHubQuotaSample, captureGitHubRateLimited } from '../../../../src/lib/telemetry/github-quota-telemetry.js';
import { maybeSendInstanceHeartbeat } from '../../../../src/lib/telemetry/instance-heartbeat.js';
import { computeOperatorHash } from '../../../../src/lib/telemetry/operator-hash.js';

const LOGIN = 'octo-login';
const EMAIL = 'octo@example.com';
const RAW_USER_ID = '678719';

describe('GitHub telemetry privacy (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  const originalVitest = process.env.VITEST;
  const originalNodeEnv = process.env.NODE_ENV;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(os.tmpdir(), 'pan-telemetry-privacy-'));
    process.env.OVERDECK_HOME = home;
    writeFileSync(join(home, 'telemetry-operator-hash'), `${computeOperatorHash(RAW_USER_ID)}\n`, { mode: 0o600 });
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    captureMock.mockClear();
    grouping.on = true;
  });

  afterEach(() => {
    if (originalVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = originalVitest;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('sends only buckets, booleans and the operatorHash — no identity, host or path', async () => {
    // A ledger that names an agent and carries samples, as a real machine's would.
    await appendLedgerEntry({ kind: 'call', caller: 'agent', agent: 'agent-pan-4264', pool: 'user', bucket: 'graphql', cost: 60, estimated: true, outcome: 'unknown' });
    await appendLedgerEntry({ kind: 'sample', caller: 'quota-sampler', pool: 'user', bucket: 'graphql', cost: 0, estimated: false, outcome: 'ok', remaining: 4956, limit: 5000, resetAt: '2026-09-27T16:00:00Z' });
    const analytics = new AnalyticsService('cli');

    captureGitHubQuotaSample({ analytics });
    await captureGitHubRateLimited({ caller: 'pipeline-membership', kind: 'primary', ownUsageLow: true }, { analytics });
    await maybeSendInstanceHeartbeat({ dashboardRunning: true, listProjects: () => [home], listAgents: () => [{ hasLivePane: true }], analytics });
    analytics.capture('server_boot', { project_count: '1-2', active_agent_count: '0' });

    const events = captureMock.mock.calls.map(([payload]) => payload as { event: string; properties: Record<string, unknown> });
    expect(events.map((payload) => payload.event)).toEqual([
      'github_quota_sample', 'github_rate_limited', 'instance_heartbeat', 'server_boot',
    ]);

    const forbidden = [os.hostname(), os.userInfo().username, os.homedir(), home, LOGIN, EMAIL, RAW_USER_ID, 'agent-pan-4264'];
    for (const payload of events) {
      const serialized = JSON.stringify(payload);
      for (const value of forbidden) expect(serialized).not.toContain(value);
      expect(serialized).not.toMatch(/\/(home|Users)\//);
      expect(payload.properties.operatorHash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('omits operatorHash while operator grouping is off, even with a cached hash', () => {
    grouping.on = false;
    new AnalyticsService('cli').capture('server_boot', { project_count: '0', active_agent_count: '0' });
    const [payload] = captureMock.mock.calls.at(-1) as [{ properties: Record<string, unknown> }];
    expect(payload.properties).not.toHaveProperty('operatorHash');
  });
});
