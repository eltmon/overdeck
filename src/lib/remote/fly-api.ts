/**
 * Fly Machines REST API Client
 *
 * Wraps the Fly Machines API (flaps) for machine lifecycle management.
 * Base URL: https://api.machines.dev/v1
 * Auth: FLY_API_TOKEN environment variable
 */

import { Data, Effect } from 'effect';
import { ConfigError } from '../errors.js';

export interface FlyMachineConfig {
  image: string;
  env?: Record<string, string>;
  size?: string;          // e.g. "shared-cpu-2x"
  memory?: number;        // MB
  region?: string;        // e.g. "iad"
  auto_destroy?: boolean;
  restart?: { policy: 'no' | 'always' | 'on-failure' };
  metadata?: Record<string, string>;
}

export interface FlyMachine {
  id: string;
  name: string;
  state: string;           // 'started', 'stopped', 'created', 'destroying', etc.
  region: string;
  image_ref?: { registry: string; repository: string; tag: string };
  instance_id?: string;
  private_ip?: string;
  created_at?: string;
  config?: {
    image: string;
    env?: Record<string, string>;
    guest?: { cpu_kind: string; cpus: number; memory_mb: number };
  };
}

export interface FlyExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export class FlyApiError extends Data.TaggedError('FlyApiError')<{
  readonly operation: string;
  readonly statusCode: number;
  readonly body: string;
  readonly message: string;
}> {}

const BASE_URL = 'https://api.machines.dev/v1';

export class FlyApiClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Effect.Effect<T, FlyApiError> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    return Effect.tryPromise({
      try: () =>
        fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
      catch: (cause) =>
        new FlyApiError({
          operation: `${method} ${path}`,
          statusCode: 0,
          body: '',
          message: `Network error: ${String(cause)}`,
        }),
    }).pipe(
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) =>
            new FlyApiError({
              operation: `${method} ${path}`,
              statusCode: 0,
              body: '',
              message: `Failed to read response: ${String(cause)}`,
            }),
        }).pipe(
          Effect.flatMap((text) => {
            if (!response.ok) {
              return Effect.fail(
                new FlyApiError({
                  operation: `${method} ${path}`,
                  statusCode: response.status,
                  body: text,
                  message: `Fly API error ${response.status} for ${method} ${path}: ${text}`,
                })
              );
            }
            if (!text) return Effect.succeed(undefined as T);
            try {
              return Effect.succeed(JSON.parse(text) as T);
            } catch {
              return Effect.succeed(text as unknown as T);
            }
          })
        )
      )
    );
  }

  /** Create a machine in an app */
  createMachine(
    appName: string,
    name: string,
    config: FlyMachineConfig
  ): Effect.Effect<FlyMachine, FlyApiError> {
    return this.request<FlyMachine>('POST', `/apps/${appName}/machines`, {
      name,
      config: {
        image: config.image,
        env: config.env,
        guest: config.size
          ? { cpu_kind: 'shared', cpus: 2, memory_mb: config.memory ?? 1024 }
          : undefined,
        restart: config.restart ?? { policy: 'no' },
        auto_destroy: config.auto_destroy,
        metadata: config.metadata,
      },
      region: config.region,
    });
  }

  /** Destroy a machine (force=true for immediate) */
  destroyMachine(appName: string, machineId: string): Effect.Effect<void, FlyApiError> {
    return this.request<void>(
      'DELETE',
      `/apps/${appName}/machines/${machineId}?force=true`
    );
  }

  /** Start a stopped machine */
  startMachine(appName: string, machineId: string): Effect.Effect<void, FlyApiError> {
    return this.request<void>(
      'POST',
      `/apps/${appName}/machines/${machineId}/start`
    );
  }

  /** Stop a running machine */
  stopMachine(
    appName: string,
    machineId: string,
    signal?: string,
    timeout?: number
  ): Effect.Effect<void, FlyApiError> {
    return this.request<void>(
      'POST',
      `/apps/${appName}/machines/${machineId}/stop`,
      signal || timeout ? { signal, timeout } : undefined
    );
  }

  /** Get a machine by ID */
  getMachine(appName: string, machineId: string): Effect.Effect<FlyMachine, FlyApiError> {
    return this.request<FlyMachine>(
      'GET',
      `/apps/${appName}/machines/${machineId}`
    );
  }

  /** List all machines in an app */
  listMachines(appName: string): Effect.Effect<FlyMachine[], FlyApiError> {
    return this.request<FlyMachine[] | null>(
      'GET',
      `/apps/${appName}/machines`
    ).pipe(Effect.map((result) => result ?? []));
  }

  /** Execute a command inside a running machine */
  execCommand(
    appName: string,
    machineId: string,
    command: string[],
    timeout: number = 30
  ): Effect.Effect<FlyExecResult, FlyApiError> {
    return this.request<FlyExecResult>(
      'POST',
      `/apps/${appName}/machines/${machineId}/exec`,
      { command, timeout }
    );
  }

  /** Wait for a machine to reach a target state */
  waitForState(
    appName: string,
    machineId: string,
    state: string,
    timeout: number = 60
  ): Effect.Effect<void, FlyApiError> {
    return this.request<void>(
      'GET',
      `/apps/${appName}/machines/${machineId}/wait?state=${state}&timeout=${timeout}`
    );
  }

  /** Create a Fly app if it doesn't exist */
  ensureApp(appName: string, orgSlug: string): Effect.Effect<void, FlyApiError> {
    return this.request<unknown>('GET', `/apps/${appName}`).pipe(
      Effect.catchTag('FlyApiError', (err) =>
        err.statusCode === 404
          ? this.request<unknown>('POST', '/apps', {
              app_name: appName,
              org_slug: orgSlug,
              network: 'default',
            })
          : Effect.fail(err)
      ),
      Effect.asVoid
    );
  }
}

/** Create a FlyApiClient from env or explicit token */
export function createFlyApiClient(token?: string): Effect.Effect<FlyApiClient, ConfigError> {
  const tok = token ?? process.env.FLY_API_TOKEN;
  if (!tok) {
    return Effect.fail(
      new ConfigError({
        message:
          'Fly API token not found. Set FLY_API_TOKEN environment variable or run: fly auth login',
      })
    );
  }
  return Effect.succeed(new FlyApiClient(tok));
}
