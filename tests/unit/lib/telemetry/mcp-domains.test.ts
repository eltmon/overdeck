/**
 * PAN-5083 W-1: the `mcp_tool` telemetry domain lists exactly the Overdeck
 * MCP tool names, so adding or removing a tool fails here until the contract
 * follows.
 */
import { describe, expect, it } from 'vitest';
import { TELEMETRY_EVENT_CATALOG, TELEMETRY_PROPERTY_DOMAINS } from '@overdeck/contracts';

import { connectorTools } from '../../../../src/lib/mcp/connector/serve.js';
import { ALL_TOOLS } from '../../../../src/lib/mcp/server.js';

describe('MCP telemetry domains', () => {
  it('mcp_tool equals the ALL_TOOLS names, sorted', () => {
    expect([...TELEMETRY_PROPERTY_DOMAINS.mcp_tool]).toEqual(ALL_TOOLS.map((tool) => tool.name).sort());
  });

  it('every connector tool name is in mcp_tool', () => {
    const domain = new Set<string>(TELEMETRY_PROPERTY_DOMAINS.mcp_tool);
    expect(connectorTools().map((tool) => tool.name).filter((name) => !domain.has(name))).toEqual([]);
  });

  it('mcp_session_seen and mcp_tool_called carry exactly their contract properties', () => {
    expect(TELEMETRY_EVENT_CATALOG.mcp_session_seen).toEqual({
      mcp_surface: 'mcp_surface',
      mcp_protocol: 'mcp_protocol',
      mcp_client: 'mcp_client',
      mcp_auth: 'mcp_auth',
    });
    expect(TELEMETRY_EVENT_CATALOG.mcp_tool_called).toEqual({
      mcp_surface: 'mcp_surface',
      mcp_client: 'mcp_client',
      mcp_tool: 'mcp_tool',
    });
  });

  it('mcp_auth and mcp_client hold the planned values', () => {
    expect([...TELEMETRY_PROPERTY_DOMAINS.mcp_auth]).toEqual(['agent_token', 'oauth', 'access_token', 'connector']);
    expect(TELEMETRY_PROPERTY_DOMAINS.mcp_client).toContain('opencode');
    expect(TELEMETRY_PROPERTY_DOMAINS.mcp_client).toContain('kimi');
  });
});
