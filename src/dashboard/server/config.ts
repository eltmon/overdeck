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
import { loadPanopticonEnvSync } from '../../lib/env-loader.js';

// ─── Config shape ──────────────────────────────────────────────────────────────

export interface ServerConfigShape {
  /** HTTP port for the dashboard API (API_PORT || PORT, default 3011) */
  readonly port: number;
  /** Dashboard host (HOST, default '0.0.0.0' so the panopticon-traefik docker container can reach the host process; set HOST=127.0.0.1 to lock down to loopback) */
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
    loadPanopticonEnvSync();

    const portStr = process.env['API_PORT'] ?? process.env['PORT'] ?? '3011';
    const port = parseInt(portStr, 10);

    if (Number.isNaN(port)) {
      throw new ServerConfigError('API_PORT', `Invalid port value: "${portStr}"`);
    }

    // PAN-1416 canonical-path guard. A dashboard started from a workspace cwd
    // (`workspaces/feature-pan-XXX/`) must NEVER bind the primary port 3011 unless
    // the operator explicitly opts in. Without this guard, a workspace dashboard
    // started for Playwright UAT can hijack pan.localhost when the canonical
    // dashboard is restarting, leaving the user looking at stale workspace code.
    const cwdIsWorkspace = /\/workspaces\/feature-pan-/i.test(process.cwd());
    const portWasExplicit = !!(process.env['API_PORT'] ?? process.env['PORT']);
    const overrideAllowed = process.env['PANOPTICON_WORKSPACE_DASHBOARD_ALLOW_PRIMARY'] === '1';
    if (cwdIsWorkspace && !portWasExplicit && !overrideAllowed) {
      const msg = (
        `Refusing to bind primary port ${port} from workspace cwd ${process.cwd()} ` +
        `(PAN-1416). Workspace dashboards must set API_PORT to a non-primary port. ` +
        `To override (e.g. when the canonical dashboard is deliberately stopped), set ` +
        `PANOPTICON_WORKSPACE_DASHBOARD_ALLOW_PRIMARY=1.`
      );
      console.error(`[panopticon] ${msg}`);
      throw new ServerConfigError('API_PORT', msg);
    }

    // Default to 0.0.0.0 so the panopticon-traefik docker container can reach the
    // dashboard via host-gateway routing. Binding to 127.0.0.1 leaves Traefik
    // returning 502 because it sees the host as 172.17.0.1 (docker bridge gateway)
    // which won't hit a loopback-only listener. Operators who need to lock the
    // dashboard down to loopback explicitly should set HOST=127.0.0.1.
    const host = process.env['HOST'] ?? '0.0.0.0';
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
