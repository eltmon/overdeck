/**
 * PAN-5070 W-6: the one message "Connect a bot" copies for the operator to paste into a bot's
 * chat. It carries the `mcp connector connect` command and tells the bot what to do with the
 * status line that command ends with (see src/lib/mcp/connector/connect-output.ts).
 */
import { parseConnectorPairLink } from '@overdeck/contracts';

import { shellQuote, type BotPlatform } from './botSnippets';

/** Mirrors CONNECT_PLATFORMS in src/lib/mcp/connector/connect-output.ts (the `--platform` values). */
export const CONNECT_PLATFORM_IDS = ['grok-bot', 'grok-build', 'hermes', 'openclaw', 'other'] as const;
export type ConnectPlatformId = (typeof CONNECT_PLATFORM_IDS)[number];
export const CONNECT_PLATFORM_LABELS: Record<ConnectPlatformId, string> = {
  'grok-bot': 'Grok Bot',
  'grok-build': 'Grok Build',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  other: 'your bot',
};

/** The dialog's platform as a `--platform` id; xai-api (public reach only) maps to 'other'. */
export function connectPlatformFor(platform: BotPlatform): ConnectPlatformId {
  return platform === 'xai-api' ? 'other' : platform;
}

export function connectMessage(input: {
  platform: ConnectPlatformId;
  botName: string;
  machineLabel: string;
  version: string;
  pairingString: string;
}): string {
  const { platform, botName, machineLabel, version, pairingString } = input;
  return [
    `Please connect yourself to my Overdeck machine "${machineLabel}" as "${botName}".`,
    '',
    'Run this command in your shell. You can run it again at any time; each run continues where the last one stopped:',
    '',
    `npx -y @overdeck/core@${version} mcp connector connect ${shellQuote(pairingString)} --name ${shellQuote(botName)} --platform ${platform}`,
    '',
    'Then act on the last line it prints. That line starts with OVERDECK_CONNECT and holds JSON:',
    '- If "status" is "authorize", show me the "url" link. I will open it and click Authorize. When I tell you I did, run the same command again.',
    '- If "status" is "retry", do what "next" says, then run the same command again.',
    '- If "status" is "error", tell me the "code" and do what "next" says.',
    '- If "status" is "ready", register exactly the MCP server in "registration", call list_conversations once, and tell me the result.',
    '',
    'The pairing code in the command works once and expires soon. Do not save it anywhere. If it is refused, ask me to copy a new message from Overdeck.',
  ].join('\n');
}

/**
 * Resolves version (serverVersion, else 'latest') and machine label (environment label, else the
 * pairing string's machineLabel, else 'this machine'), then calls connectMessage.
 */
export function connectMessageFor(input: {
  platform: ConnectPlatformId;
  botName: string;
  pairingString: string;
  environment?: { label?: string; serverVersion?: string } | null;
}): string {
  const version = input.environment?.serverVersion ?? 'latest';
  const machineLabel = input.environment?.label ?? parseConnectorPairLink(input.pairingString)?.machineLabel ?? 'this machine';
  return connectMessage({
    platform: input.platform,
    botName: input.botName,
    machineLabel,
    version,
    pairingString: input.pairingString,
  });
}

/** `navigator.clipboard.writeText`; resolves false (never throws) when there is no clipboard or it refuses. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
