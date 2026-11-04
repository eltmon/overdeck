import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_LOCAL_URL,
  PUBLIC_MCP_PLACEHOLDER_URL,
  XAI_ALLOWED_TOOLS,
  connectorCommands,
  defaultBotName,
  grokBotMcpJson,
  grokBuildMcpJson,
  hermesConfig,
  openclawConfig,
  oauthIssueCommand,
  oauthLevelForScopes,
  shellQuote,
  tokenSetup,
  xaiExample,
} from '../botSnippets';

const TAILSCALE_URL = 'https://box.tail1.ts.net/mcp';
const TOKEN = 'odk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd';

describe('hermesConfig', () => {
  it('connector reach carries the local URL and the connector bearer placeholder', () => {
    const text = hermesConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL });
    expect(text).toContain('http://127.0.0.1:7466/mcp');
    expect(text).toContain('Bearer ${OVERDECK_CONNECTOR_LOCAL_TOKEN}');
  });

  it('tailscale reach carries the given URL and the MCP token placeholder', () => {
    const text = hermesConfig({ reach: 'tailscale', url: TAILSCALE_URL });
    expect(text).toContain(TAILSCALE_URL);
    expect(text).toContain('Bearer ${OVERDECK_MCP_TOKEN}');
  });

  it('puts summary and allow_answers under settings', () => {
    for (const text of [
      hermesConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL }),
      hermesConfig({ reach: 'tailscale', url: TAILSCALE_URL }),
    ]) {
      expect(text).toContain('      settings:\n        summary: true\n        allow_answers: false');
      expect(text).not.toContain('\n      summary: true');
    }
  });
});

describe('openclawConfig', () => {
  it('always declares the streamable-http transport', () => {
    expect(openclawConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL })).toContain('transport: "streamable-http"');
    expect(openclawConfig({ reach: 'tailscale', url: TAILSCALE_URL })).toContain('transport: "streamable-http"');
  });

  it('tailscale reach uses the MCP token placeholder for both the header and the plugin config', () => {
    const text = openclawConfig({ reach: 'tailscale', url: TAILSCALE_URL });
    expect(text).toContain(TAILSCALE_URL);
    expect(text).toContain('Bearer ${OVERDECK_MCP_TOKEN}');
    expect(text).toContain('localToken: "${OVERDECK_MCP_TOKEN}"');
  });
});

describe('grokBuildMcpJson', () => {
  it('points the overdeck server at the plugin run script', () => {
    const parsed = JSON.parse(grokBuildMcpJson()) as { mcpServers: { overdeck: { command: string } } };
    expect(parsed.mcpServers.overdeck.command).toBe('${GROK_PLUGIN_ROOT}/scripts/run-mcp.sh');
  });
});

describe('grokBotMcpJson', () => {
  it('declares exactly one server whose url is the given public MCP URL', () => {
    const url = 'https://box.tail1.ts.net:8443/mcp';
    const parsed = JSON.parse(grokBotMcpJson({ url })) as { mcpServers: Record<string, { url: string }> };
    const servers = Object.values(parsed.mcpServers);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.url.endsWith(':8443/mcp')).toBe(true);
  });
});

describe('xaiExample', () => {
  it('embeds the URL and every allowed tool', () => {
    const text = xaiExample({ url: PUBLIC_MCP_PLACEHOLDER_URL });
    expect(text).toContain(PUBLIC_MCP_PLACEHOLDER_URL);
    for (const tool of XAI_ALLOWED_TOOLS) {
      expect(text).toContain(tool);
    }
  });

  it('uses the current xAI model and the overdeck server label', () => {
    const text = xaiExample({ url: PUBLIC_MCP_PLACEHOLDER_URL });
    expect(text).toContain('model: "grok-4.7"');
    expect(text).toContain('server_label: "overdeck"');
    expect(text).toContain('authorization: process.env.OVERDECK_MCP_TOKEN');
    expect(text).not.toContain('"grok-4",');
  });
});

describe('oauthIssueCommand', () => {
  it('shell-quotes the name and includes the level', () => {
    const text = oauthIssueCommand({ name: "op's bot", level: 'operate' });
    expect(text).toContain(shellQuote("op's bot"));
    expect(text).toContain('--level operate');
  });
});

describe('oauthLevelForScopes', () => {
  it('maps the four D-8 cases', () => {
    expect(oauthLevelForScopes(['read:state', 'approve'])).toBe('approve');
    expect(oauthLevelForScopes(['read:state', 'operate'])).toBe('operate');
    expect(oauthLevelForScopes(['read:state', 'tell'])).toBe('message');
    expect(oauthLevelForScopes(['read:state'])).toBe('read');
  });
});

describe('connectorCommands', () => {
  it('has two lines when serve is false and four lines when serve is true', () => {
    const base = { version: '0.60.0', pairingString: 'overdeck-connector:/pair#v=1' };
    expect(connectorCommands({ ...base, serve: false }).split('\n')).toHaveLength(2);
    expect(connectorCommands({ ...base, serve: true }).split('\n')).toHaveLength(4);
  });
});

describe('shellQuote', () => {
  it("escapes an embedded single quote", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe('defaultBotName', () => {
  it('appends "bot" to a label that does not already end in Bot', () => {
    expect(defaultBotName('hermes')).toBe('Hermes bot');
    expect(defaultBotName('openclaw')).toBe('OpenClaw bot');
    expect(defaultBotName('grok-build')).toBe('Grok Build bot');
    expect(defaultBotName('xai-api')).toBe('xAI API bot');
  });

  it('leaves a label already ending in "Bot" unchanged', () => {
    expect(defaultBotName('grok-bot')).toBe('Grok Bot');
  });
});

describe('tokenSetup', () => {
  const cases: Array<{ platform: 'hermes' | 'openclaw' | 'grok-build'; reach: 'tailscale' | 'this-computer' }> = [
    { platform: 'grok-build', reach: 'this-computer' },
    { platform: 'grok-build', reach: 'tailscale' },
    { platform: 'hermes', reach: 'tailscale' },
    { platform: 'openclaw', reach: 'tailscale' },
  ];

  it.each(cases)('contains the given token for $platform / $reach', ({ platform, reach }) => {
    const text = tokenSetup({ platform, reach, token: TOKEN, origin: TAILSCALE_URL });
    expect(text).toContain(TOKEN);
  });
});

describe('every function except tokenSetup never emits a secret-shaped token', () => {
  const TOKEN_PATTERN = /od[krl]_/;

  it('never appears in the non-token snippet functions', () => {
    const outputs = [
      hermesConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL }),
      hermesConfig({ reach: 'tailscale', url: TAILSCALE_URL }),
      openclawConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL }),
      openclawConfig({ reach: 'tailscale', url: TAILSCALE_URL }),
      grokBuildMcpJson(),
      grokBotMcpJson({ url: PUBLIC_MCP_PLACEHOLDER_URL }),
      xaiExample({ url: PUBLIC_MCP_PLACEHOLDER_URL }),
      oauthIssueCommand({ name: 'bot', level: 'read' }),
      connectorCommands({ version: '0.60.0', pairingString: 'overdeck-connector:/pair#v=1', serve: true }),
    ];
    for (const output of outputs) {
      expect(output).not.toMatch(TOKEN_PATTERN);
    }
  });

  it('does appear in tokenSetup output', () => {
    expect(tokenSetup({ platform: 'hermes', reach: 'tailscale', token: TOKEN, origin: TAILSCALE_URL })).toMatch(TOKEN_PATTERN);
  });
});
