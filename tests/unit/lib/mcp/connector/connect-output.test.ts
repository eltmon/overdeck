import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  AUTHORIZE_NEXT,
  CONNECT_CODES,
  CONNECT_NEXT,
  CONNECT_STATUS_PREFIX,
  type ConnectStatus,
  exitCodeFor,
  failureStatus,
  formatStatusLine,
  hermesRegistrationYaml,
  openclawRegistrationCommand,
  READY_NEXT,
  registrationFor,
  registrationLines,
} from '../../../../../src/lib/mcp/connector/connect-output.js';

const REGISTRATION = registrationFor({ version: '0.75.0', env: {} });

const STATUSES: ConnectStatus[] = [
  {
    v: 1,
    status: 'ready',
    machine: 'studio',
    environmentId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9',
    route: 'relay',
    scopes: ['read:state', 'tell'],
    registration: REGISTRATION,
    next: READY_NEXT,
  },
  { v: 1, status: 'authorize', url: 'https://account.overdeck.ai/activate?user_code=ABCDEFGH', expiresAt: '2026-11-05T00:15:00.000Z', next: AUTHORIZE_NEXT },
  failureStatus('network'),
  failureStatus('pairing-failed', 'line one\nline two'),
];

describe('formatStatusLine (PAN-5069 FR-2)', () => {
  it('prints one line that starts with OVERDECK_CONNECT { and parses back to the status', () => {
    for (const status of STATUSES) {
      const line = formatStatusLine(status);
      expect(line.startsWith(`${CONNECT_STATUS_PREFIX}{`)).toBe(true);
      expect(line).not.toContain('\n');
      const parsed = JSON.parse(line.slice(CONNECT_STATUS_PREFIX.length)) as ConnectStatus;
      expect(parsed).toEqual(status);
      expect(parsed.v).toBe(1);
    }
  });
});

describe('exitCodeFor', () => {
  it('maps ready, error, authorize and retry to 0, 1, 3 and 4', () => {
    expect(STATUSES.map(exitCodeFor)).toEqual([0, 3, 4, 1]);
    expect(exitCodeFor(failureStatus('bad-pairing-string'))).toBe(1);
  });
});

describe('failureStatus (FR-7)', () => {
  it('makes network, machine-offline, machine-unreachable and verify-failed retries and the rest errors', () => {
    const retries = CONNECT_CODES.filter((code) => failureStatus(code).status === 'retry');
    expect(retries.sort()).toEqual(['machine-offline', 'machine-unreachable', 'network', 'verify-failed']);
  });

  it('has a non-empty next text for every code and leaves detail out when there is none', () => {
    for (const code of CONNECT_CODES) {
      expect(CONNECT_NEXT[code].length).toBeGreaterThan(0);
      expect(failureStatus(code).next).toBe(CONNECT_NEXT[code]);
      expect(failureStatus(code)).not.toHaveProperty('detail');
    }
    expect(failureStatus('pairing-failed', 'HTTP 500')).toMatchObject({ code: 'pairing-failed', detail: 'HTTP 500' });
  });
});

describe('registrationFor (FR-6)', () => {
  it('runs serve --stdio from the pinned package and adds the home only when it is set', () => {
    expect(REGISTRATION).toEqual({
      name: 'overdeck',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@overdeck/core@0.75.0', 'mcp', 'connector', 'serve', '--stdio'],
    });
    expect(registrationFor({ version: '0.75.0', env: { OVERDECK_CONNECTOR_HOME: '   ' } })).not.toHaveProperty('env');
    expect(registrationFor({ version: '0.75.0', env: { OVERDECK_CONNECTOR_HOME: '/data/connector' } }).env).toEqual({
      OVERDECK_CONNECTOR_HOME: '/data/connector',
    });
  });
});

describe('registrationLines', () => {
  it('shows Grok Bot an mcp.json block that parses to mcpServers.overdeck', () => {
    const lines = registrationLines('grok-bot', REGISTRATION);
    expect(lines[0]).toBe("Add this to the plugin's mcp.json:");
    const json = JSON.parse(lines.slice(1).join('\n')) as { mcpServers: { overdeck: { command: string; args: string[] } } };
    expect(json.mcpServers.overdeck).toEqual({ command: 'npx', args: REGISTRATION.args });
  });

  it('tells Grok Build the plugin starts the connector and still shows the stdio server', () => {
    const lines = registrationLines('grok-build', registrationFor({ version: '0.75.0', env: { OVERDECK_CONNECTOR_HOME: '/h' } }));
    expect(lines[0]).toContain('scripts/run-mcp.sh');
    expect(JSON.parse(lines.slice(2).join('\n'))).toEqual({ command: 'npx', args: REGISTRATION.args, env: { OVERDECK_CONNECTOR_HOME: '/h' } });
  });

  it('shows every other platform a generic stdio server named overdeck', () => {
    for (const platform of ['other'] as const) {
      const lines = registrationLines(platform, REGISTRATION);
      expect(lines[0]).toBe('Register a stdio MCP server named "overdeck":');
      expect(JSON.parse(lines.slice(1).join('\n'))).toEqual({ command: 'npx', args: REGISTRATION.args });
    }
  });
});

describe('hermesRegistrationYaml and registrationLines("hermes", …) (FR-1, FR-3, NFR-2)', () => {
  it('parses to the mcp_servers.overdeck stdio entry with command and args', () => {
    const parsed = parse(hermesRegistrationYaml(REGISTRATION)) as { mcp_servers: { overdeck: { command: string; args: string[] } } };
    expect(parsed).toEqual({ mcp_servers: { overdeck: { command: 'npx', args: REGISTRATION.args } } });
  });

  it('includes env when the registration carries OVERDECK_CONNECTOR_HOME', () => {
    const withHome = registrationFor({ version: '0.75.0', env: { OVERDECK_CONNECTOR_HOME: '/data/connector' } });
    const parsed = parse(hermesRegistrationYaml(withHome)) as { mcp_servers: { overdeck: { env: { OVERDECK_CONNECTOR_HOME: string } } } };
    expect(parsed.mcp_servers.overdeck.env).toEqual({ OVERDECK_CONNECTOR_HOME: '/data/connector' });
  });

  it('prints a header, the YAML, a reload line and an mcp_allowlist line', () => {
    const lines = registrationLines('hermes', REGISTRATION);
    expect(lines[0]).toContain('Add the overdeck entry to mcp_servers');
    expect(lines.slice(1, 5).join('\n')).toBe(hermesRegistrationYaml(REGISTRATION));
    expect(lines[5]).toContain('/reload-mcp');
    expect(lines[6]).toContain('mcp_allowlist');
  });
});

describe('openclawRegistrationCommand and registrationLines("openclaw", …) (FR-2, FR-3, NFR-2)', () => {
  it('shell-quotes a JSON stdio server that parses back to command and args', () => {
    const command = openclawRegistrationCommand(REGISTRATION);
    expect(command.startsWith("openclaw mcp set overdeck '")).toBe(true);
    expect(command.endsWith("'")).toBe(true);
    const inner = command.slice("openclaw mcp set overdeck '".length, -1);
    expect(JSON.parse(inner)).toEqual({ command: 'npx', args: REGISTRATION.args });
  });

  it('escapes a single quote in the connector home so the command still parses', () => {
    const withQuote = registrationFor({ version: '0.75.0', env: { OVERDECK_CONNECTOR_HOME: "/data/it's" } });
    const command = openclawRegistrationCommand(withQuote);
    const inner = command.slice("openclaw mcp set overdeck '".length, -1);
    const unescaped = inner.split("'\\''").join("'");
    expect(JSON.parse(unescaped)).toEqual({ command: 'npx', args: withQuote.args, env: { OVERDECK_CONNECTOR_HOME: "/data/it's" } });
  });

  it('prints a register line, the command, and a plugin HTTP-route line mentioning localToken', () => {
    const lines = registrationLines('openclaw', REGISTRATION);
    expect(lines[1]).toBe(openclawRegistrationCommand(REGISTRATION));
    expect(lines[2]).toContain('localToken');
  });
});
