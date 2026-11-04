/**
 * PAN-4927 W-BOT1 (PAN-4951): the result of "Connect a bot" — the connector reach's pairing
 * string and commands, or a token reach's token setup lines — plus the platform's config
 * snippet. Only `tokenSetup` ever carries token text (NFR-2).
 */
import { useQuery } from '@tanstack/react-query';

import { ANYWHERE_ENVIRONMENT_QUERY_KEY, loadEnvironment, pairingExpiresInText } from './anywhereApi';
import {
  BOT_PLATFORMS,
  CONNECTOR_LOCAL_URL,
  connectorCommands,
  grokBotMcpJson,
  grokBuildMcpJson,
  hermesConfig,
  oauthIssueCommand,
  oauthLevelForScopes,
  openclawConfig,
  tokenSetup,
  xaiExample,
  type BotPlatform,
} from './botSnippets';
import { CopyField } from './McpUrlDialog';

export type ConnectBotResult =
  | { kind: 'connector'; pairingString: string; expiresAt: string }
  | { kind: 'token'; reach: 'tailscale' | 'this-computer'; token: string; origin: string; tailscaleSetUp: boolean }
  | { kind: 'public'; url: string; urlUnknown: boolean; name: string; scopes: readonly string[] };

interface ConnectBotOutputProps {
  platform: BotPlatform;
  result: ConnectBotResult;
  onDone: () => void;
}

function configLabelFor(platform: BotPlatform): string {
  return BOT_PLATFORMS.find((entry) => entry.id === platform)?.label ?? platform;
}

function connectorConfigFor(platform: BotPlatform): string {
  if (platform === 'hermes') return hermesConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL });
  if (platform === 'openclaw') return openclawConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL });
  return grokBuildMcpJson();
}

function tokenConfigFor(platform: BotPlatform, origin: string): string {
  if (platform === 'grok-build') return grokBuildMcpJson();
  const url = `${origin}/mcp`;
  return platform === 'openclaw'
    ? openclawConfig({ reach: 'tailscale', url })
    : hermesConfig({ reach: 'tailscale', url });
}

export function ConnectBotOutput({ platform, result, onDone }: ConnectBotOutputProps) {
  const { data: environment } = useQuery({ queryKey: ANYWHERE_ENVIRONMENT_QUERY_KEY, queryFn: loadEnvironment });
  const version = environment?.serverVersion ?? 'latest'; // D-11
  const label = configLabelFor(platform);

  return (
    <div className="space-y-3">
      {result.kind === 'connector' && (
        <>
          <CopyField label="Pairing string" value={result.pairingString} />
          <p className="text-xs text-muted-foreground">{pairingExpiresInText(Date.parse(result.expiresAt))}</p>
          <CopyField
            label="Connector commands"
            value={connectorCommands({ version, pairingString: result.pairingString, serve: platform !== 'grok-build' })}
            multiline
          />
          <CopyField label={`${label} config`} value={connectorConfigFor(platform)} multiline />
        </>
      )}
      {result.kind === 'token' && (
        <>
          <p className="text-xs text-muted-foreground">This token is shown once.</p>
          <CopyField
            label="Token setup"
            value={tokenSetup({ platform, reach: result.reach, token: result.token, origin: result.origin })}
            multiline
          />
          <CopyField label={`${label} config`} value={tokenConfigFor(platform, result.origin)} multiline />
          {result.reach === 'tailscale' && !result.tailscaleSetUp && (
            <p className="text-xs text-muted-foreground">
              Tailscale Serve is not set up on this machine yet. Set up Tailscale, then replace the placeholder.
            </p>
          )}
        </>
      )}
      {result.kind === 'public' && (
        <>
          <CopyField label="Public MCP URL" value={result.url} />
          {result.urlUnknown && (
            <p className="text-xs text-muted-foreground">Tailscale is not set up, so the public URL is unknown.</p>
          )}
          {platform === 'grok-bot' ? (
            <>
              <CopyField label="Grok Bot mcp.json" value={grokBotMcpJson({ url: result.url })} multiline />
              <p className="text-xs text-muted-foreground">
                Grok Bot signs in with OAuth on first use. Approve the sign-in in this dashboard and pick its access level there.
              </p>
            </>
          ) : (
            <>
              <CopyField
                label="Get a token"
                value={oauthIssueCommand({ name: result.name, level: oauthLevelForScopes(result.scopes) })}
              />
              <CopyField label="xAI API example" value={xaiExample({ url: result.url })} multiline />
            </>
          )}
        </>
      )}
      <button
        type="button"
        onClick={onDone}
        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Done
      </button>
    </div>
  );
}
