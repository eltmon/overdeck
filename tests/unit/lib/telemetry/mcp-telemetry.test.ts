/**
 * PAN-5083 W-3: the MCP usage tracker — dedupe per UTC day, the usage ledger,
 * the opt-out and the stdio transport hook.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  McpUsageTelemetry,
  mcpTelemetryEnabled,
  observeMcpTransport,
  type McpUsageLabel,
} from '../../../../src/lib/telemetry/mcp.js';

const DAY_ONE = Date.UTC(2026, 10, 5, 23, 59);
const DAY_TWO = Date.UTC(2026, 10, 6, 0, 1);

const dashboard: McpUsageLabel = { surface: 'dashboard_http', auth: 'access_token', callerKey: 'tok-1' };
const stdio: McpUsageLabel = { surface: 'stdio', auth: 'agent_token', callerKey: 'stdio' };

function initialize(name = 'claude-code', protocolVersion = '2025-11-25') {
  return { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name, version: '1.0.0' } } };
}

describe('McpUsageTelemetry (PAN-5083)', () => {
  let dir: string;
  let ledger: string;
  let nowMs: number;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pan-mcp-telemetry-'));
    ledger = join(dir, 'telemetry-mcp-seen.json');
    nowMs = DAY_ONE;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function tracker(capture = vi.fn(), enabled: () => boolean = () => true) {
    return { capture, usage: new McpUsageTelemetry({ analytics: () => ({ capture }), now: () => nowMs, enabled, ledgerFile: () => ledger }) };
  }

  it('captures one mcp_session_seen for two identical initializes on one day', async () => {
    const { capture, usage } = tracker();
    usage.noteRequest(dashboard, initialize());
    usage.noteRequest(dashboard, initialize());
    await usage.settled();

    expect(capture.mock.calls).toEqual([
      ['mcp_session_seen', { mcp_surface: 'dashboard_http', mcp_protocol: '2025-11-25', mcp_client: 'claude_code', mcp_auth: 'access_token' }],
    ]);
    expect(JSON.parse(readFileSync(ledger, 'utf8'))).toEqual({
      day: '2026-11-05',
      keys: ['session|dashboard_http|claude_code|2025-11-25|access_token'],
    });
  });

  it('captures again after the UTC day changes', async () => {
    const { capture, usage } = tracker();
    usage.noteRequest(dashboard, initialize());
    await usage.settled();
    nowMs = DAY_TWO;
    usage.noteRequest(dashboard, initialize());
    await usage.settled();

    expect(capture).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(ledger, 'utf8')).day).toBe('2026-11-06');
  });

  it('sends nothing from a fresh tracker for a key already in the ledger today', async () => {
    const first = tracker();
    first.usage.noteRequest(stdio, initialize('codex-mcp-client', '2025-06-18'));
    await first.usage.settled();
    expect(first.capture).toHaveBeenCalledTimes(1);

    const second = tracker();
    second.usage.noteRequest(stdio, initialize('codex-mcp-client', '2025-06-18'));
    second.usage.noteRequest(stdio, initialize('claude-code', '2025-11-25'));
    await second.usage.settled();

    expect(second.capture.mock.calls).toEqual([
      ['mcp_session_seen', { mcp_surface: 'stdio', mcp_protocol: '2025-11-25', mcp_client: 'claude_code', mcp_auth: 'agent_token' }],
    ]);
    expect(JSON.parse(readFileSync(ledger, 'utf8')).keys).toEqual([
      'session|stdio|codex|2025-06-18|agent_token',
      'session|stdio|claude_code|2025-11-25|agent_token',
    ]);
  });

  it('captures for connector surfaces without creating the ledger file', async () => {
    const { capture, usage } = tracker();
    usage.noteRequest({ surface: 'connector_http', auth: 'connector', callerKey: 'connector_http' }, initialize('overdeck-connector'));
    usage.noteRequest({ surface: 'connector_stdio', auth: 'connector', callerKey: 'connector_stdio' }, initialize('hermes'));
    usage.noteToolCall({ surface: 'connector_stdio', auth: 'connector', callerKey: 'connector_stdio' }, 'done', {});
    await usage.settled();

    expect(capture.mock.calls).toEqual([
      ['mcp_session_seen', { mcp_surface: 'connector_http', mcp_protocol: '2025-11-25', mcp_client: 'overdeck_connector', mcp_auth: 'connector' }],
      ['mcp_session_seen', { mcp_surface: 'connector_stdio', mcp_protocol: '2025-11-25', mcp_client: 'hermes', mcp_auth: 'connector' }],
      ['mcp_tool_called', { mcp_surface: 'connector_stdio', mcp_client: 'hermes', mcp_tool: 'done' }],
    ]);
    expect(existsSync(ledger)).toBe(false);
  });

  it('sends nothing and touches no ledger when disabled', async () => {
    const { capture, usage } = tracker(vi.fn(), () => false);
    usage.noteRequest(dashboard, initialize());
    usage.noteToolCall(dashboard, 'list_conversations', {});
    await usage.settled();

    expect(capture).not.toHaveBeenCalled();
    expect(existsSync(ledger)).toBe(false);
  });

  it('never throws when the analytics client throws', async () => {
    const { usage } = tracker(vi.fn(() => { throw new Error('posthog down'); }));
    expect(() => usage.noteRequest(dashboard, initialize())).not.toThrow();
    expect(() => usage.noteToolCall(dashboard, 'list_conversations', {})).not.toThrow();
    await expect(usage.settled()).resolves.toBeUndefined();
  });

  it('attributes a tool call to the client remembered for the caller key', async () => {
    const { capture, usage } = tracker();
    usage.noteRequest(dashboard, initialize('codex-mcp-client', '2025-06-18'));
    usage.noteToolCall(dashboard, 'list_conversations', { name: 'list_conversations', arguments: {} });
    usage.noteToolCall(dashboard, 'list_conversations', { name: 'list_conversations', arguments: {} });
    usage.noteToolCall({ ...dashboard, callerKey: 'tok-2' }, 'list_conversations', {});
    await usage.settled();

    expect(capture.mock.calls.filter(([event]) => event === 'mcp_tool_called')).toEqual([
      ['mcp_tool_called', { mcp_surface: 'dashboard_http', mcp_client: 'codex', mcp_tool: 'list_conversations' }],
      ['mcp_tool_called', { mcp_surface: 'dashboard_http', mcp_client: 'other', mcp_tool: 'list_conversations' }],
    ]);
  });

  it('ignores an unknown tool name', async () => {
    const { capture, usage } = tracker();
    usage.noteToolCall(dashboard, 'not_a_tool', {});
    await usage.settled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('does not emit a session for a plain v1 tools/call', async () => {
    const { capture, usage } = tracker();
    usage.noteRequest(dashboard, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'done' } }, '2025-11-25');
    await usage.settled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('observeMcpTransport sees a message delivered right after the handler is set', () => {
    const { usage } = tracker();
    const noteRequest = vi.spyOn(usage, 'noteRequest');
    const transport = { onmessage: undefined } as unknown as Transport;
    observeMcpTransport(transport, stdio, usage);

    const handler = vi.fn();
    transport.onmessage = handler;
    transport.onmessage?.(initialize() as never);

    expect(noteRequest).toHaveBeenCalledWith(stdio, initialize());
    expect(handler).toHaveBeenCalledWith(initialize(), undefined);
    transport.onmessage = undefined;
    expect(transport.onmessage).toBeUndefined();
  });
});

describe('MCP telemetry opt-out (PAN-5083 NFR-2)', () => {
  const saved = { VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV, OVERDECK_TELEMETRY: process.env.OVERDECK_TELEMETRY };
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pan-mcp-optout-'));
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    process.env.OVERDECK_TELEMETRY = '0';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('OVERDECK_TELEMETRY=0 sends nothing and writes no ledger', async () => {
    expect(mcpTelemetryEnabled()).toBe(false);
    const capture = vi.fn();
    const ledger = join(dir, 'telemetry-mcp-seen.json');
    const usage = new McpUsageTelemetry({ analytics: () => ({ capture }), ledgerFile: () => ledger });
    usage.noteRequest(dashboard, initialize());
    usage.noteToolCall(dashboard, 'list_conversations', {});
    await usage.settled();

    expect(capture).not.toHaveBeenCalled();
    expect(existsSync(ledger)).toBe(false);
  });
});
