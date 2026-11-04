/**
 * PAN-4927 W-BOT1 (PAN-4951): the bot config snippets. The integration READMEs (W-INT1..4)
 * must match these functions.
 */

export const CONNECTOR_LOCAL_URL = 'http://127.0.0.1:7466/mcp';
export const TAILSCALE_PLACEHOLDER_ORIGIN = 'https://YOUR-MACHINE.YOUR-TAILNET.ts.net';
export const PUBLIC_MCP_PLACEHOLDER_URL = 'https://YOUR-MACHINE.YOUR-TAILNET.ts.net:8443/mcp';
export const XAI_ALLOWED_TOOLS = ['list_conversations', 'read_conversation', 'list_pending_input'] as const;
export const XAI_DEFAULT_MODEL = 'grok-4.7';
export const XAI_SERVER_LABEL = 'overdeck';

export type BotPlatform = 'hermes' | 'openclaw' | 'grok-build' | 'grok-bot' | 'xai-api';
export type BotReach = 'connector' | 'tailscale' | 'this-computer' | 'public';
export type OauthLevel = 'read' | 'message' | 'operate' | 'approve';

export const BOT_PLATFORMS: ReadonlyArray<{ id: BotPlatform; label: string; reaches: readonly BotReach[] }> = [
  { id: 'hermes', label: 'Hermes', reaches: ['connector', 'tailscale'] },
  { id: 'openclaw', label: 'OpenClaw', reaches: ['connector', 'tailscale'] },
  { id: 'grok-build', label: 'Grok Build', reaches: ['this-computer', 'connector', 'tailscale'] },
  { id: 'grok-bot', label: 'Grok Bot', reaches: ['public'] },
  { id: 'xai-api', label: 'xAI API', reaches: ['public'] },
];

export const REACH_LABELS: Record<BotReach, string> = {
  connector: 'Overdeck connector',
  tailscale: 'Tailscale',
  'this-computer': 'This computer',
  public: 'Public MCP',
};

/** `"<label> bot"`, except a label already ending in "Bot" is returned as is. */
export function defaultBotName(platform: BotPlatform): string {
  const label = BOT_PLATFORMS.find((entry) => entry.id === platform)?.label ?? platform;
  return label.endsWith('Bot') ? label : `${label} bot`;
}

/** Single-quotes a shell argument, escaping embedded `'` as `'\''`. */
export function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

function hermesHeader(reach: 'connector' | 'tailscale'): string {
  return reach === 'connector' ? 'Bearer ${OVERDECK_CONNECTOR_LOCAL_TOKEN}' : 'Bearer ${OVERDECK_MCP_TOKEN}';
}

export function hermesConfig({ reach, url }: { reach: 'connector' | 'tailscale'; url: string }): string {
  const heading = reach === 'connector'
    ? '# ~/.hermes/config.yaml — connector route (default)'
    : '# ~/.hermes/config.yaml — Tailscale route';
  return [
    heading,
    'mcp_servers:',
    '  overdeck:',
    `    url: "${url}"`,
    '    headers:',
    `      Authorization: "${hermesHeader(reach)}"`,
    'plugins:',
    '  enabled: [overdeck]',
    '  entries:',
    '    overdeck:',
    '      mcp_allowlist: ["overdeck"]',
    '      settings:',
    '        summary: true',
    '        allow_answers: false',
  ].join('\n');
}

export function openclawConfig({ reach, url }: { reach: 'connector' | 'tailscale'; url: string }): string {
  const headerToken = reach === 'connector' ? '${OVERDECK_CONNECTOR_LOCAL_TOKEN}' : '${OVERDECK_MCP_TOKEN}';
  const pluginsLine = reach === 'connector'
    ? 'plugins: { entries: { overdeck: { config: { localToken: "${OVERDECK_CONNECTOR_LOCAL_TOKEN}" } } } },'
    : `plugins: { entries: { overdeck: { config: { connectorUrl: "${url}", localToken: "\${OVERDECK_MCP_TOKEN}" } } } },`;
  return [
    '// openclaw config',
    'mcp: { servers: { overdeck: {',
    `  url: "${url}",`,
    '  transport: "streamable-http",   // the default is "sse", which Overdeck does not serve',
    `  headers: { Authorization: "Bearer ${headerToken}" },`,
    '} } },',
    pluginsLine,
  ].join('\n');
}

/** W-INT3 step 2; the plugin's `run-mcp.sh` picks the connector when paired, else `pan mcp serve`. */
export function grokBuildMcpJson(): string {
  return JSON.stringify(
    { mcpServers: { overdeck: { command: '${GROK_PLUGIN_ROOT}/scripts/run-mcp.sh', env: {} } } },
    null,
    2,
  );
}

export function grokBotMcpJson({ url }: { url: string }): string {
  return JSON.stringify({ mcpServers: { overdeck: { url } } }, null, 2);
}

export function xaiExample({ url }: { url: string }): string {
  const allowedTools = XAI_ALLOWED_TOOLS.map((tool) => `"${tool}"`).join(', ');
  return [
    'const response = await fetch("https://api.x.ai/v1/responses", {',
    '  method: "POST",',
    '  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.XAI_API_KEY}` },',
    '  body: JSON.stringify({',
    `    model: "${XAI_DEFAULT_MODEL}",`,
    '    input: "List my Overdeck conversations.",',
    '    tools: [{',
    '      type: "mcp",',
    `      server_url: "${url}",`,
    `      server_label: "${XAI_SERVER_LABEL}",`,
    '      authorization: process.env.OVERDECK_MCP_TOKEN,',
    `      allowed_tools: [${allowedTools}],`,
    '    }],',
    '  }),',
    '});',
    'console.log(await response.json());',
  ].join('\n');
}

export function oauthIssueCommand({ name, level }: { name: string; level: OauthLevel }): string {
  return [
    `pan mcp oauth issue --name ${shellQuote(name)} --level ${level}`,
    '# Put the access token it prints in OVERDECK_MCP_TOKEN for the script.',
  ].join('\n');
}

/** D-8: the xAI OAuth level implied by the dialog's ticked bot scopes. */
export function oauthLevelForScopes(scopes: readonly string[]): OauthLevel {
  if (scopes.includes('approve')) return 'approve';
  if (scopes.includes('operate')) return 'operate';
  if (scopes.includes('tell')) return 'message';
  return 'read';
}

export function connectorCommands({ version, pairingString, serve }: {
  version: string;
  pairingString: string;
  serve: boolean;
}): string {
  const lines = [
    `npx -y @overdeck/core@${version} mcp connector login`,
    `npx -y @overdeck/core@${version} mcp connector pair ${shellQuote(pairingString)}`,
  ];
  if (serve) {
    lines.push(
      `npx -y @overdeck/core@${version} mcp connector serve`,
      'export OVERDECK_CONNECTOR_LOCAL_TOKEN="$(cat "${OVERDECK_CONNECTOR_HOME:-$HOME/.overdeck-connector}/local-token")"',
    );
  }
  return lines.join('\n');
}

/** The only function that emits token text. */
export function tokenSetup({ platform, reach, token, origin }: {
  platform: BotPlatform;
  reach: 'tailscale' | 'this-computer';
  token: string;
  origin: string;
}): string {
  if (reach === 'this-computer') {
    return [
      `umask 077 && printf '%s' '${token}' > "$HOME/.overdeck/grok-build-mcp-token"`,
      'export OVERDECK_MCP_TOKEN_FILE="$HOME/.overdeck/grok-build-mcp-token"',
    ].join('\n');
  }
  if (platform === 'grok-build') {
    return [
      `umask 077 && printf '%s' '${token}' > "$HOME/.overdeck-mcp-token"`,
      'export OVERDECK_MCP_TOKEN_FILE="$HOME/.overdeck-mcp-token"',
      `export OVERDECK_DASHBOARD_URL="${origin}"`,
      '# Needs Overdeck on that computer: npm i -g @overdeck/core',
    ].join('\n');
  }
  return [
    "# Add to the bot's environment (Hermes: ~/.hermes/.env)",
    `OVERDECK_MCP_TOKEN=${token}`,
  ].join('\n');
}
