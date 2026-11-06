/**
 * PAN-5083: pure MCP session classification for telemetry.
 *
 * Turns a raw JSON-RPC message (or batch) plus the optional
 * `MCP-Protocol-Version` header into closed-domain facts: the requested
 * protocol revision and the client family. It reads only raw JSON-RPC fields,
 * so it works the same before and after the SDK v2 move (PAN-5082) and sees a
 * 2026-07-28 request that SDK 1.30.1 refuses. A raw client name, version or
 * title never leaves this module; only the bucket does.
 *
 * This module imports only types from `@overdeck/contracts`.
 */
import type { TelemetryMcpAuth, TelemetryMcpClient, TelemetryMcpProtocol } from '@overdeck/contracts';

export const MCP_META_PROTOCOL_KEY = 'io.modelcontextprotocol/protocolVersion';
export const MCP_META_CLIENT_KEY = 'io.modelcontextprotocol/clientInfo';

const KNOWN_PROTOCOLS: ReadonlySet<string> = new Set<TelemetryMcpProtocol>([
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
]);

/** D-4: substring rules on the lower-cased client name, first match wins. */
const CLIENT_RULES: ReadonlyArray<readonly [readonly string[], TelemetryMcpClient]> = [
  [['cursor'], 'cursor'],
  [['codex'], 'codex'],
  [['claude-code', 'claude code'], 'claude_code'],
  [['visual studio code', 'vscode', 'vs code'], 'vscode'],
  [['chatgpt', 'openai'], 'chatgpt'],
  [['grok'], 'grok'],
  [['hermes'], 'hermes'],
  [['openclaw'], 'openclaw'],
  [['gemini'], 'gemini'],
  [['opencode'], 'opencode'],
  [['kimi'], 'kimi'],
  [['overdeck'], 'overdeck_connector'],
];

const MAX_CLIENT_NAME_LENGTH = 200;

export interface McpSessionFacts {
  protocol: TelemetryMcpProtocol;
  client: TelemetryMcpClient | undefined;
}

/** D-3: an exact match against the domain; anything else is `other`. */
export function bucketMcpProtocol(raw: unknown): TelemetryMcpProtocol {
  return typeof raw === 'string' && KNOWN_PROTOCOLS.has(raw) ? (raw as TelemetryMcpProtocol) : 'other';
}

/** D-4: the client family for a raw `clientInfo.name`. */
export function bucketMcpClient(name: unknown): TelemetryMcpClient {
  if (typeof name !== 'string' || name.length > MAX_CLIENT_NAME_LENGTH) return 'other';
  const lower = name.toLowerCase();
  for (const [needles, bucket] of CLIENT_RULES) {
    if (needles.some((needle) => lower.includes(needle))) return bucket;
  }
  return 'other';
}

/** D-5: the credential kind of a token record or credential, read structurally. */
export function mcpAuthForToken(record: object): Exclude<TelemetryMcpAuth, 'connector'> {
  const fields = record as { oauthClientId?: unknown; agentId?: unknown };
  if (typeof fields.oauthClientId === 'string' && fields.oauthClientId !== '') return 'oauth';
  if (typeof fields.agentId === 'string' && fields.agentId !== '') return 'agent_token';
  return 'access_token';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function metaOf(params: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(params)?._meta);
}

function factsForMessage(message: unknown, protocolHeader: string | undefined): McpSessionFacts[] {
  const record = asRecord(message);
  if (!record || typeof record.method !== 'string') return [];
  const params = asRecord(record.params);
  if (record.method === 'initialize') {
    return [{ protocol: bucketMcpProtocol(params?.protocolVersion), client: bucketMcpClient(asRecord(params?.clientInfo)?.name) }];
  }
  const meta = metaOf(params);
  if (!meta || !(MCP_META_PROTOCOL_KEY in meta || MCP_META_CLIENT_KEY in meta)) return [];
  const clientInfo = asRecord(meta[MCP_META_CLIENT_KEY]);
  return [{
    protocol: bucketMcpProtocol(meta[MCP_META_PROTOCOL_KEY] ?? protocolHeader),
    client: clientInfo ? bucketMcpClient(clientInfo.name) : undefined,
  }];
}

/**
 * D-2: the session facts in a JSON-RPC message or batch. Only an `initialize`
 * or a request whose `params._meta` carries a 2026-07-28 key counts; a plain
 * v1 request yields nothing. Never throws.
 */
export function mcpSessionFacts(message: unknown, protocolHeader?: string): McpSessionFacts[] {
  try {
    if (Array.isArray(message)) return message.flatMap((element) => factsForMessage(element, protocolHeader));
    return factsForMessage(message, protocolHeader);
  } catch {
    return [];
  }
}

/** D-10: the client family a request names in `params._meta`, if any. */
export function mcpRequestClient(params: unknown): TelemetryMcpClient | undefined {
  try {
    const clientInfo = asRecord(metaOf(params)?.[MCP_META_CLIENT_KEY]);
    return clientInfo ? bucketMcpClient(clientInfo.name) : undefined;
  } catch {
    return undefined;
  }
}
