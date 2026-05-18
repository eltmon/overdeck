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
import { loadPanopticonEnv } from '../../lib/env-loader.js';

// ─── Config shape ──────────────────────────────────────────────────────────────

export interface ServerConfigShape {
  /** HTTP port for the dashboard API (API_PORT || PORT, default 3011) */
  readonly port: number;
  /** Dashboard host (HOST, default '127.0.0.1') */
  readonly host: string;
  /** Optional Linear API key (null if not set) */
  readonly linearApiKey: string | null;
  /** Optional Anthropic API key (null if not set) */
  readonly anthropicApiKey: string | null;
  /** Dashboard base URL for self-referencing links */
  readonly dashboardUrl: string;
  /** Panopticon home directory */
  readonly panopticonHome: string;

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
  'panopticon/dashboard/ServerConfig',
) {}

// ─── Layer ────────────────────────────────────────────────────────────────────

/**
 * Build the ServerConfig layer by reading env vars.
 * Loads ~/.panopticon.env first (idempotent — won't override existing vars).
 */
export const ServerConfigLayer = Layer.effect(
  ServerConfig,
  Effect.sync((): ServerConfigShape => {
    // Load .panopticon.env (idempotent)
    loadPanopticonEnv();

    const portStr = process.env['API_PORT'] ?? process.env['PORT'] ?? '3011';
    const port = parseInt(portStr, 10);

    if (Number.isNaN(port)) {
      throw new ServerConfigError('API_PORT', `Invalid port value: "${portStr}"`);
    }

    const host = process.env['HOST'] ?? '127.0.0.1';
    const linearApiKey = process.env['LINEAR_API_KEY'] || null;
    const anthropicApiKey = process.env['ANTHROPIC_API_KEY'] || null;
    const dashboardUrl = process.env['DASHBOARD_URL'] ?? `http://localhost:${port}`;
    const panopticonHome =
      process.env['PANOPTICON_HOME'] ?? `${process.env['HOME'] ?? homedir()}/.panopticon`;

    return {
      port,
      host,
      linearApiKey,
      anthropicApiKey,
      dashboardUrl,
      panopticonHome,

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
