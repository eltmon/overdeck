/**
 * ServerConfig — Effect service wrapping dashboard env vars and configuration (PAN-428 B3)
 *
 * Provides typed access to all env vars currently used by the dashboard server.
 * The server obtains config via `yield* ServerConfig` rather than reading process.env directly.
 *
 * Usage (in Effect code):
 *   const config = yield* ServerConfig
 *   const port = config.port
 */

import { homedir } from 'node:os';
import { Effect, Layer, Context } from 'effect';
import { loadOverdeckEnvSync } from '../../lib/env-loader.js';
import { getDashboardIdentity, readHostDashboardApiPort, shouldRefuseHostDashboardPort } from './identity.js';

// ─── Config shape ──────────────────────────────────────────────────────────────

export interface ServerConfigShape {
  /** HTTP port for the dashboard API (API_PORT || PORT, default 3011) */
  readonly port: number;
  /** Dashboard host (HOST, default '0.0.0.0' so the overdeck-traefik docker container can reach the host process; set HOST=127.0.0.1 to lock down to loopback) */
  readonly host: string;
  /** Optional Linear API key (null if not set) */
  readonly linearApiKey: string | null;
  /** Optional Anthropic API key (null if not set) */
  readonly anthropicApiKey: string | null;
  /** Dashboard base URL for self-referencing links */
  readonly dashboardUrl: string;
  /** Overdeck home directory */
  readonly overdeckHome: string;

  /** Typed error: get Linear API key or fail */
  readonly requireLinearApiKey: Effect.Effect<string, ServerConfigError>;
  /** Typed error: get Anthropic API key or fail */
  readonly requireAnthropicApiKey: Effect.Effect<string, ServerConfigError>;
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class ServerConfigError extends Error {
  readonly _tag = 'ServerConfigError' as const;
  constructor(readonly variable: string, message: string) {
    super(`ServerConfig: ${message}`);
  }
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class ServerConfig extends Context.Service<ServerConfig, ServerConfigShape>()(
  'overdeck/dashboard/ServerConfig',
) {}

// ─── Layer ────────────────────────────────────────────────────────────────────

/**
 * Build the ServerConfig layer by reading env vars.
 * Loads ~/.overdeck.env first (idempotent — won't override existing vars).
 */
export const ServerConfigLayer = Layer.effect(
  ServerConfig,
  Effect.sync((): ServerConfigShape => {
    // Load .overdeck.env (idempotent)
    loadOverdeckEnvSync();

    const portStr = process.env['API_PORT'] ?? process.env['PORT'] ?? '3011';
    const port = parseInt(portStr, 10);

    if (Number.isNaN(port)) {
      throw new ServerConfigError('API_PORT', `Invalid port value: "${portStr}"`);
    }

    // A host-side peer dashboard or workspace checkout must never bind the host
    // dashboard API port. Workspace-container peers use an isolated network
    // namespace, so the identity guard allows their canonical compose port.
    const identity = getDashboardIdentity();
    const hostDashboardApiPort = readHostDashboardApiPort();
    const overrideAllowed = process.env['OVERDECK_WORKSPACE_DASHBOARD_ALLOW_PRIMARY'] === '1';
    const agentId = process.env['OVERDECK_AGENT_ID'];
    const pipelineRoleUsingOverride =
      overrideAllowed && agentId !== undefined && /^(agent-|planning-|flywheel-)/.test(agentId);
    if (pipelineRoleUsingOverride) {
      const msg = (
        `Refusing OVERDECK_WORKSPACE_DASHBOARD_ALLOW_PRIMARY=1 for pipeline-role identity ` +
        `OVERDECK_AGENT_ID=${agentId}. Work, planning, review, and flywheel agents must never bind ` +
        `the host dashboard port; use the workspace container endpoint instead. Only an operator-supervised ` +
        `conversation (conv-*) or a process with no agent identity may use this emergency override.`
      );
      console.error(`[overdeck] ${msg}`);
      throw new ServerConfigError('OVERDECK_WORKSPACE_DASHBOARD_ALLOW_PRIMARY', msg);
    }
    if (shouldRefuseHostDashboardPort({
      repoRoot: identity.repoRoot,
      mode: identity.mode,
      port,
      hostDashboardApiPort,
    }) && !overrideAllowed) {
      const msg = (
        `Refusing to bind host dashboard port ${port} from repoRoot=${identity.repoRoot} ` +
        `mode=${identity.mode}. Peer/workspace dashboards must set PORT or API_PORT ` +
        `to a non-host port. To override (e.g. when the canonical dashboard is deliberately stopped), set ` +
        `OVERDECK_WORKSPACE_DASHBOARD_ALLOW_PRIMARY=1.`
      );
      console.error(`[overdeck] ${msg}`);
      throw new ServerConfigError('API_PORT', msg);
    }

    // Default to 0.0.0.0 so the overdeck-traefik docker container can reach the
    // dashboard via host-gateway routing. Binding to 127.0.0.1 leaves Traefik
    // returning 502 because it sees the host as 172.17.0.1 (docker bridge gateway)
    // which won't hit a loopback-only listener. Operators who need to lock the
    // dashboard down to loopback explicitly should set HOST=127.0.0.1.
    const host = process.env['HOST'] ?? '0.0.0.0';
    const linearApiKey = process.env['LINEAR_API_KEY'] || null;
    const anthropicApiKey = process.env['ANTHROPIC_API_KEY'] || null;
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? `http://localhost:${port}`;
    const overdeckHome =
      process.env['OVERDECK_HOME'] ?? `${process.env['HOME'] ?? homedir()}/.overdeck`;

    return {
      port,
      host,
      linearApiKey,
      anthropicApiKey,
      dashboardUrl,
      overdeckHome,

      requireLinearApiKey: linearApiKey
        ? Effect.succeed(linearApiKey)
        : Effect.fail(new ServerConfigError('LINEAR_API_KEY', 'LINEAR_API_KEY is not set')),

      requireAnthropicApiKey: anthropicApiKey
        ? Effect.succeed(anthropicApiKey)
        : Effect.fail(
            new ServerConfigError('ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY is not set'),
          ),
    };
  }),
);
