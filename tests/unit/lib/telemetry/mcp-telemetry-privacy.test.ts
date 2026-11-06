/**
 * PAN-5083 W-8 (NFR-1): no raw MCP client name, version, title, website,
 * caller key, tool argument, host name, user name or home path reaches
 * PostHog — only closed-domain `mcp_*` values plus the standard stamped
 * properties. The opt-out case lives in mcp-telemetry.test.ts, because this
 * file mocks config.js.
 */
import { mkdtempSync, rmSync } from 'node:fs';
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
vi.mock('../../../../src/lib/config-yaml.js', () => ({
  loadConfigSync: () => ({ config: { telemetry: { enabled: true, operator_grouping: false } } }),
}));

import { TELEMETRY_EVENT_CATALOG, TELEMETRY_PROPERTY_DOMAINS } from '@overdeck/contracts';
import { McpUsageTelemetry, type McpUsageLabel } from '../../../../src/lib/telemetry/mcp.js';
import { AnalyticsService } from '../../../../src/lib/telemetry/service.js';

describe('MCP telemetry privacy (PAN-5083)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  const originalVitest = process.env.VITEST;
  const originalNodeEnv = process.env.NODE_ENV;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(os.tmpdir(), 'pan-mcp-telemetry-privacy-'));
    process.env.OVERDECK_HOME = home;
    // AnalyticsService creates no client while the process is blocked as a test.
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    captureMock.mockClear();
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

  it('sends only closed-domain mcp_* values — no client identity, caller key, argument, host or path', async () => {
    const analytics = new AnalyticsService('server');
    const usage = new McpUsageTelemetry({ analytics: () => analytics, enabled: () => true });
    const label: McpUsageLabel = { surface: 'dashboard_http', auth: 'oauth', callerKey: 'tok_secret_caller' };

    usage.noteRequest(label, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'claude-code-internal-zq7', version: '2.1.293', title: 'Claude Code', websiteUrl: 'https://claude.com/claude-code' },
      },
    }, '2025-11-25');
    usage.noteToolCall(label, 'send_message', {
      name: 'send_message',
      arguments: { conversation: 'conv-private', message: 'secret prompt' },
    });
    await usage.settled();

    const events = captureMock.mock.calls.map(([payload]) => payload as { event: string; properties: Record<string, unknown> });
    expect(events.map((payload) => payload.event)).toEqual(['mcp_session_seen', 'mcp_tool_called']);

    const forbidden = [
      'internal-zq7', '2.1.293', 'Claude Code', 'claude.com', 'tok_secret_caller', 'conv-private', 'secret prompt',
      os.hostname(), os.userInfo().username, home,
    ];
    for (const payload of events) {
      const serialized = JSON.stringify(payload);
      for (const value of forbidden) expect(serialized, value).not.toContain(value);

      const catalog = TELEMETRY_EVENT_CATALOG[payload.event as 'mcp_session_seen' | 'mcp_tool_called'] as Record<string, keyof typeof TELEMETRY_PROPERTY_DOMAINS>;
      const mcpProperties = Object.keys(payload.properties).filter((property) => property.startsWith('mcp_'));
      expect(mcpProperties.sort()).toEqual(Object.keys(catalog).sort());
      for (const property of mcpProperties) {
        const domain: readonly unknown[] = TELEMETRY_PROPERTY_DOMAINS[catalog[property]!];
        expect(domain, property).toContain(payload.properties[property]);
      }
    }
  });
});
