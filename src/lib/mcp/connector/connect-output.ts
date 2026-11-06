/**
 * The `pan mcp connector connect` contract (PAN-5069 FR-2, FR-6, FR-7).
 *
 * Every run ends with one status line, the last line of stdout:
 * `OVERDECK_CONNECT {"v":1,"status":…}`. A bot acts on that line alone. The status is
 * `ready` (exit 0), `error` (exit 1), `authorize` (exit 3) or `retry` (exit 4); failures carry
 * a stable `code` and a `next` sentence written for the bot. `ready` carries the stdio MCP
 * registration the bot adds to its own config, and `registrationLines` shows it in the
 * platform's own config shape for a human reading the output.
 */
export const CONNECT_STATUS_PREFIX = 'OVERDECK_CONNECT ';
export const CONNECT_EXIT = { ready: 0, error: 1, authorize: 3, retry: 4 } as const;
export const CONNECT_PLATFORMS = ['grok-bot', 'grok-build', 'hermes', 'openclaw', 'other'] as const;
export type ConnectPlatform = (typeof CONNECT_PLATFORMS)[number];

/** Every failure code a status line can carry: the pairing codes (except `not-signed-in`) plus sign-in and verify. */
export const CONNECT_CODES = [
  'bad-pairing-string',
  'unsupported-platform',
  'home-unreadable',
  'signin-denied',
  'network',
  'directory-refused',
  'machine-not-in-account',
  'machine-offline',
  'relay-plan-needed',
  'machine-unreachable',
  'pairing-code-refused',
  'key-mismatch',
  'pairing-failed',
  'verify-failed',
] as const;
export type ConnectCode = (typeof CONNECT_CODES)[number];

/** The failures a later run of the same command can clear without the user doing anything. */
const RETRY_CODES: ReadonlySet<ConnectCode> = new Set<ConnectCode>(['network', 'machine-offline', 'machine-unreachable', 'verify-failed']);

const COPY_AGAIN = 'Ask the user to click Copy again in Overdeck (Settings → Anywhere → Bots) and paste the new message.';
const LOGOUT_THEN_RERUN = 'run the same npx command with "mcp connector logout" in place of "mcp connector connect …", then run the same command again';

/** What the bot does next, for each failure code. */
export const CONNECT_NEXT: Readonly<Record<ConnectCode, string>> = {
  'bad-pairing-string': COPY_AGAIN,
  'unsupported-platform': "This computer's OS or CPU cannot run the connector; tell the user.",
  'home-unreadable': 'Show the user detail; the connector home has a bad file.',
  'signin-denied':
    'The sign-in was cancelled or this GitHub account is not invited. Tell the user, then run the same command again for a new link.',
  network: 'overdeck.ai could not be reached. Run the same command again in a minute.',
  'directory-refused': `Show the user detail. If it says the sign-in is not valid, ${LOGOUT_THEN_RERUN}.`,
  'machine-not-in-account': `You signed in with an account that does not own this machine. To fix it, ${LOGOUT_THEN_RERUN}, and ask the user to authorize with the account their Overdeck uses.`,
  'machine-offline': 'The machine is offline. Ask the user to start Overdeck there, then run the same command again.',
  'relay-plan-needed': 'This network blocks direct connections and the account has no relay plan. Tell the user.',
  'machine-unreachable': 'The machine could not be reached. Run the same command again in a minute.',
  'pairing-code-refused': `The pairing code expired, was cancelled or was already used. ${COPY_AGAIN}`,
  'key-mismatch': `The machine's key does not match the message. ${COPY_AGAIN}`,
  'pairing-failed': `${COPY_AGAIN} Show them detail.`,
  'verify-failed': 'Paired, but the test call failed. Run the same command again.',
};

export const AUTHORIZE_NEXT = 'Show the user this link and ask them to open it and click Authorize. When they say they did, run the same command again.';
export const READY_NEXT = 'Register the MCP server shown above, then call list_conversations once and tell the user the result.';

export interface ConnectRegistration {
  name: 'overdeck';
  transport: 'stdio';
  command: 'npx';
  args: string[];
  env?: { OVERDECK_CONNECTOR_HOME: string };
}

export type ConnectStatus =
  | { v: 1; status: 'ready'; machine: string; environmentId: string; route: 'direct' | 'relay'; scopes: string[]; registration: ConnectRegistration; next: string }
  | { v: 1; status: 'authorize'; url: string; expiresAt: string; next: string }
  | { v: 1; status: 'retry'; code: ConnectCode; detail?: string; next: string }
  | { v: 1; status: 'error'; code: ConnectCode; detail?: string; next: string };

/** The `retry` or `error` status for `code`, with its fixed `next` text. */
export function failureStatus(code: ConnectCode, detail?: string): ConnectStatus {
  return {
    v: 1,
    status: RETRY_CODES.has(code) ? 'retry' : 'error',
    code,
    ...(detail ? { detail } : {}),
    next: CONNECT_NEXT[code],
  };
}

/** `OVERDECK_CONNECT {"v":1,…}` on one line (JSON.stringify escapes every newline). */
export function formatStatusLine(status: ConnectStatus): string {
  return `${CONNECT_STATUS_PREFIX}${JSON.stringify(status)}`;
}

export function exitCodeFor(status: ConnectStatus): number {
  return CONNECT_EXIT[status.status];
}

/** The stdio server a bot registers; `env` only when the connector home was set explicitly. */
export function registrationFor(input: { version: string; env: NodeJS.ProcessEnv }): ConnectRegistration {
  const home = input.env.OVERDECK_CONNECTOR_HOME?.trim();
  return {
    name: 'overdeck',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', `@overdeck/core@${input.version}`, 'mcp', 'connector', 'serve', '--stdio'],
    ...(home ? { env: { OVERDECK_CONNECTOR_HOME: home } } : {}),
  };
}

function stdioServer(registration: ConnectRegistration): { command: string; args: string[]; env?: Record<string, string> } {
  return { command: registration.command, args: registration.args, ...(registration.env ? { env: registration.env } : {}) };
}

function jsonLines(value: unknown): string[] {
  return JSON.stringify(value, null, 2).split('\n');
}

/** Human lines that show the registration in the platform's own shape. */
export function registrationLines(platform: ConnectPlatform, registration: ConnectRegistration): string[] {
  const server = stdioServer(registration);
  switch (platform) {
    case 'grok-bot':
      return ["Add this to the plugin's mcp.json:", ...jsonLines({ mcpServers: { [registration.name]: server } })];
    case 'grok-build':
      return [
        "The Overdeck plugin's scripts/run-mcp.sh starts this connector on its own; nothing to register.",
        'Without the plugin, register this stdio server:',
        ...jsonLines(server),
      ];
    default:
      return [`Register a stdio MCP server named "${registration.name}":`, ...jsonLines(server)];
  }
}
