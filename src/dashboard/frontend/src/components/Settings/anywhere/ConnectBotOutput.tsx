/**
 * PAN-4927 W-BOT1 (PAN-4951): the connector-reach result of "Connect a bot" — the pairing
 * string, the commands that pair and serve the connector, and the platform's config snippet.
 */
import { useQuery } from '@tanstack/react-query';

import { ANYWHERE_ENVIRONMENT_QUERY_KEY, loadEnvironment, pairingExpiresInText } from './anywhereApi';
import {
  BOT_PLATFORMS,
  CONNECTOR_LOCAL_URL,
  connectorCommands,
  grokBuildMcpJson,
  hermesConfig,
  openclawConfig,
  type BotPlatform,
} from './botSnippets';
import { CopyField } from './McpUrlDialog';

interface ConnectBotOutputProps {
  platform: BotPlatform;
  pairingString: string;
  expiresAt: string;
  onDone: () => void;
}

function configFor(platform: BotPlatform): string {
  if (platform === 'hermes') return hermesConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL });
  if (platform === 'openclaw') return openclawConfig({ reach: 'connector', url: CONNECTOR_LOCAL_URL });
  return grokBuildMcpJson();
}

export function ConnectBotOutput({ platform, pairingString, expiresAt, onDone }: ConnectBotOutputProps) {
  const { data: environment } = useQuery({ queryKey: ANYWHERE_ENVIRONMENT_QUERY_KEY, queryFn: loadEnvironment });
  const version = environment?.serverVersion ?? 'latest'; // D-11
  const label = BOT_PLATFORMS.find((entry) => entry.id === platform)?.label ?? platform;

  return (
    <div className="space-y-3">
      <CopyField label="Pairing string" value={pairingString} />
      <p className="text-xs text-muted-foreground">{pairingExpiresInText(Date.parse(expiresAt))}</p>
      <CopyField
        label="Connector commands"
        value={connectorCommands({ version, pairingString, serve: platform !== 'grok-build' })}
        multiline
      />
      <CopyField label={`${label} config`} value={configFor(platform)} multiline />
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
