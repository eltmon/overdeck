/**
 * PAN-5083: MCP usage telemetry — the only door for `mcp_session_seen` and
 * `mcp_tool_called`.
 *
 * HTTP surfaces call `noteRequest` with the parsed body and the
 * `MCP-Protocol-Version` header before the SDK transport runs, so a request
 * the transport refuses is still seen. Stdio surfaces install
 * `observeMcpTransport` before `connect`. The `tools/call` handler in
 * `../mcp/server.ts` calls `noteToolCall`.
 *
 * Each event is sent at most once per UTC day per key (D-6, D-9). Process
 * memory is the fast path; the dashboard and `pan mcp serve` surfaces also
 * keep the keys sent today in `~/.overdeck/telemetry-mcp-seen.json`, because
 * every agent session runs its own `pan mcp serve`. Connector surfaces dedupe
 * in memory only and never write that file (D-7).
 *
 * Both note methods are synchronous and never throw; nothing awaits them, and
 * a throwing analytics client or a failed ledger write never changes an MCP
 * response (NFR-3). With telemetry off, nothing is sent and the ledger is
 * neither read nor written (NFR-2).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  TELEMETRY_PROPERTY_DOMAINS,
  type TelemetryEventName,
  type TelemetryMcpAuth,
  type TelemetryMcpClient,
  type TelemetryMcpSurface,
  type TelemetryMcpTool,
  type TelemetryPropertiesFor,
} from '@overdeck/contracts';
import { getOverdeckHome } from '../paths.js';
import { resolveTelemetryEnabled } from './config.js';
import { mcpRequestClient, mcpSessionFacts } from './mcp-classify.js';
import {
  getAnalyticsClientTypeForProcess,
  getAnalyticsService,
  telemetryBlockedForProcess,
  trackAnalyticsTask,
  type AnalyticsService,
} from './service.js';

export interface McpUsageLabel {
  surface: TelemetryMcpSurface;
  auth: TelemetryMcpAuth;
  /** D-11: ties a later tools/call to the client seen earlier; process-local, never sent. */
  callerKey: string;
}

export interface McpUsageTelemetryOptions {
  analytics?: () => Pick<AnalyticsService, 'capture'>;
  now?: () => number;
  enabled?: () => boolean;
  ledgerFile?: () => string;
}

interface Ledger {
  day: string;
  keys: Set<string>;
}

const MAX_REMEMBERED_CALLERS = 256;
const MCP_TOOLS: ReadonlySet<string> = new Set(TELEMETRY_PROPERTY_DOMAINS.mcp_tool);
const UNPERSISTED_SURFACES: ReadonlySet<TelemetryMcpSurface> = new Set(['connector_http', 'connector_stdio']);

/** D-12: telemetry is on for this process and config; false on any throw. */
export function mcpTelemetryEnabled(): boolean {
  try {
    return !telemetryBlockedForProcess() && resolveTelemetryEnabled();
  } catch {
    return false;
  }
}

function defaultLedgerFile(): string {
  return join(getOverdeckHome(), 'telemetry-mcp-seen.json');
}

async function readLedgerKeys(file: string, day: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { day?: unknown; keys?: unknown };
    if (parsed.day !== day || !Array.isArray(parsed.keys)) return new Set();
    return new Set(parsed.keys.filter((key): key is string => typeof key === 'string'));
  } catch {
    return new Set();
  }
}

export class McpUsageTelemetry {
  private readonly analytics: () => Pick<AnalyticsService, 'capture'>;
  private readonly now: () => number;
  private readonly enabled: () => boolean;
  private readonly ledgerFile: () => string;
  private day = '';
  private readonly sent = new Set<string>();
  private readonly remembered = new Map<string, TelemetryMcpClient>();
  private ledger: Ledger | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: McpUsageTelemetryOptions = {}) {
    this.analytics = options.analytics ?? (() => getAnalyticsService(getAnalyticsClientTypeForProcess()));
    this.now = options.now ?? Date.now;
    this.enabled = options.enabled ?? mcpTelemetryEnabled;
    this.ledgerFile = options.ledgerFile ?? defaultLedgerFile;
  }

  /** Record the session facts in one inbound JSON-RPC message or batch. */
  noteRequest(label: McpUsageLabel, message: unknown, protocolHeader?: string): void {
    try {
      const facts = mcpSessionFacts(message, protocolHeader);
      if (facts.length === 0) return;
      const day = this.currentDay();
      for (const fact of facts) {
        if (fact.client !== undefined) this.remember(label.callerKey, fact.client);
        const client = fact.client ?? this.remembered.get(label.callerKey) ?? 'other';
        this.emitOnce(day, label, `session|${label.surface}|${client}|${fact.protocol}|${label.auth}`, 'mcp_session_seen', {
          mcp_surface: label.surface,
          mcp_protocol: fact.protocol,
          mcp_client: client,
          mcp_auth: label.auth,
        });
      }
    } catch {
      // Telemetry must never fail an MCP request.
    }
  }

  /** Record that a known Overdeck tool was called (D-9, D-10). */
  noteToolCall(label: McpUsageLabel, toolName: string, params: unknown): void {
    try {
      if (!MCP_TOOLS.has(toolName)) return;
      const tool = toolName as TelemetryMcpTool;
      const day = this.currentDay();
      const client = mcpRequestClient(params) ?? this.remembered.get(label.callerKey) ?? 'other';
      this.emitOnce(day, label, `tool|${label.surface}|${client}|${tool}`, 'mcp_tool_called', {
        mcp_surface: label.surface,
        mcp_client: client,
        mcp_tool: tool,
      });
    } catch {
      // Telemetry must never fail an MCP request.
    }
  }

  /** Resolves when queued ledger work has finished (tests). */
  settled(): Promise<void> {
    return this.chain;
  }

  private currentDay(): string {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.sent.clear();
      this.ledger = undefined;
    }
    return day;
  }

  private remember(callerKey: string, client: TelemetryMcpClient): void {
    this.remembered.delete(callerKey);
    this.remembered.set(callerKey, client);
    if (this.remembered.size > MAX_REMEMBERED_CALLERS) {
      const oldest = this.remembered.keys().next().value;
      if (oldest !== undefined) this.remembered.delete(oldest);
    }
  }

  private emitOnce<Event extends TelemetryEventName>(
    day: string,
    label: McpUsageLabel,
    key: string,
    event: Event,
    properties: TelemetryPropertiesFor<Event>,
  ): void {
    if (this.sent.has(key)) return;
    if (!this.enabled()) return;
    this.sent.add(key);
    const capture = (): void => {
      try {
        this.analytics().capture(event, properties);
      } catch {
        // Analytics must never fail the caller.
      }
    };
    if (UNPERSISTED_SURFACES.has(label.surface)) {
      capture();
      return;
    }
    this.chain = trackAnalyticsTask(this.chain.then(() => this.persist(day, key, capture)).catch(() => undefined));
  }

  private async persist(day: string, key: string, capture: () => void): Promise<void> {
    const file = this.ledgerFile();
    if (this.ledger?.day !== day) this.ledger = { day, keys: await readLedgerKeys(file, day) };
    const ledger = this.ledger;
    if (ledger.keys.has(key)) return;
    capture();
    ledger.keys.add(key);
    for (const existing of await readLedgerKeys(file, day)) ledger.keys.add(existing);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ day, keys: [...ledger.keys] })}\n`);
    await rename(tmp, file);
  }
}

export const mcpUsageTelemetry = new McpUsageTelemetry();

/**
 * Observe every inbound message on a stdio transport. Install before
 * `server.connect`: `Protocol.connect` assigns `onmessage`, and the setter
 * wraps it, so a message buffered before `connect` returns is still seen.
 */
export function observeMcpTransport(transport: Transport, label: McpUsageLabel, usage: McpUsageTelemetry = mcpUsageTelemetry): void {
  type Handler = NonNullable<Transport['onmessage']>;
  const wrap = (value: Transport['onmessage']): Transport['onmessage'] => {
    if (typeof value !== 'function') return value;
    const handler: Handler = value;
    return (message, extra) => {
      usage.noteRequest(label, message);
      handler(message, extra);
    };
  };
  let stored = wrap(transport.onmessage);
  Object.defineProperty(transport, 'onmessage', {
    configurable: true,
    enumerable: true,
    get: () => stored,
    set: (value: Transport['onmessage']) => { stored = wrap(value); },
  });
}
