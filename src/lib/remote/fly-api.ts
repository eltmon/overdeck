/**
 * Fly Machines REST API Client
 *
 * Wraps the Fly Machines API (flaps) for machine lifecycle management.
 * Base URL: https://api.machines.dev/v1
 * Auth: FLY_API_TOKEN environment variable
 */

import { Effect } from 'effect';
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

export class FlyApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: string
  ) {
    super(message);
    this.name = 'FlyApiError';
  }
}

const BASE_URL = 'https://api.machines.dev/v1';

export class FlyApiClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new FlyApiError(
        `Fly API error ${response.status} for ${method} ${path}: ${text}`,
        response.status,
        text
      );
    }

    if (!text) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /** Create a machine in an app */
  async createMachine(
    appName: string,
    name: string,
    config: FlyMachineConfig
  ): Promise<FlyMachine> {
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
  async destroyMachine(appName: string, machineId: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/apps/${appName}/machines/${machineId}?force=true`
    );
  }

  /** Start a stopped machine */
  async startMachine(appName: string, machineId: string): Promise<void> {
    await this.request<void>(
      'POST',
      `/apps/${appName}/machines/${machineId}/start`
    );
  }

  /** Stop a running machine */
  async stopMachine(
    appName: string,
    machineId: string,
    signal?: string,
    timeout?: number
  ): Promise<void> {
    await this.request<void>(
      'POST',
      `/apps/${appName}/machines/${machineId}/stop`,
      signal || timeout ? { signal, timeout } : undefined
    );
  }

  /** Get a machine by ID */
  async getMachine(appName: string, machineId: string): Promise<FlyMachine> {
    return this.request<FlyMachine>(
      'GET',
      `/apps/${appName}/machines/${machineId}`
    );
  }

  /** List all machines in an app */
  async listMachines(appName: string): Promise<FlyMachine[]> {
    const result = await this.request<FlyMachine[] | null>(
      'GET',
      `/apps/${appName}/machines`
    );
    return result ?? [];
  }

  /** Execute a command inside a running machine */
  async execCommand(
    appName: string,
    machineId: string,
    command: string[],
    timeout: number = 30
  ): Promise<FlyExecResult> {
    return this.request<FlyExecResult>(
      'POST',
      `/apps/${appName}/machines/${machineId}/exec`,
      { command, timeout }
    );
  }

  /** Wait for a machine to reach a target state */
  async waitForState(
    appName: string,
    machineId: string,
    state: string,
    timeout: number = 60
  ): Promise<void> {
    await this.request<void>(
      'GET',
      `/apps/${appName}/machines/${machineId}/wait?state=${state}&timeout=${timeout}`
    );
  }

  /** Create a Fly app if it doesn't exist */
  async ensureApp(appName: string, orgSlug: string): Promise<void> {
    try {
      await this.request<unknown>('GET', `/apps/${appName}`);
    } catch (err) {
      if (err instanceof FlyApiError && err.statusCode === 404) {
        await this.request<unknown>('POST', '/apps', {
          app_name: appName,
          org_slug: orgSlug,
          network: 'default',
        });
      } else {
        throw err;
      }
    }
  }
}

/** Create a FlyApiClient from env or explicit token */
export function createFlyApiClientSync(token?: string): FlyApiClient {
  const tok = token ?? process.env.FLY_API_TOKEN;
  if (!tok) {
    throw new Error(
      'Fly API token not found. Set FLY_API_TOKEN environment variable or run: fly auth login'
    );
  }
  return new FlyApiClient(tok);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Additive Effect-typed wrappers around the FlyApiClient methods and the
// constructor helper, so callers in Effect graphs can stay end-to-end Effect
// without `Effect.tryPromise`-wrapping every call site. The wrappers surface
// HTTP failures as `FlyApiError` (already a tagged class) and missing-token
// failures as `ConfigError`.

const toFlyApiError = (cause: unknown): FlyApiError =>
  cause instanceof FlyApiError
    ? cause
    : new FlyApiError(
        cause instanceof Error ? cause.message : String(cause),
        0,
        '',
      );

/** Build a FlyApiClient from env or explicit token (Effect variant). */
export const createFlyApiClient = (
  token?: string,
): Effect.Effect<FlyApiClient, ConfigError> =>
  Effect.try({
    try: () => createFlyApiClientSync(token),
    catch: (cause) =>
      new ConfigError({
        message:
          cause instanceof Error ? cause.message : 'Failed to build FlyApiClient',
        cause,
      }),
  });

/** Create a machine in an app (Effect variant). */
export const createMachine = (
  client: FlyApiClient,
  appName: string,
  name: string,
  config: FlyMachineConfig,
): Effect.Effect<FlyMachine, FlyApiError> =>
  Effect.tryPromise({
    try: () => client.createMachine(appName, name, config),
    catch: toFlyApiError,
  });

/** Destroy a machine (Effect variant). */
export const destroyMachine = (
  client: FlyApiClient,
  appName: string,
  machineId: string,
): Effect.Effect<void, FlyApiError> =>
  Effect.tryPromise({
    try: () => client.destroyMachine(appName, machineId),
    catch: toFlyApiError,
  });

/** Start a stopped machine (Effect variant). */
export const startMachine = (
  client: FlyApiClient,
  appName: string,
  machineId: string,
): Effect.Effect<void, FlyApiError> =>
  Effect.tryPromise({
    try: () => client.startMachine(appName, machineId),
    catch: toFlyApiError,
  });

/** Stop a running machine (Effect variant). */
export const stopMachine = (
  client: FlyApiClient,
  appName: string,
  machineId: string,
  signal?: string,
  timeout?: number,
): Effect.Effect<void, FlyApiError> =>
  Effect.tryPromise({
    try: () => client.stopMachine(appName, machineId, signal, timeout),
    catch: toFlyApiError,
  });

/** Get a machine by ID (Effect variant). */
export const getMachine = (
  client: FlyApiClient,
  appName: string,
  machineId: string,
): Effect.Effect<FlyMachine, FlyApiError> =>
  Effect.tryPromise({
    try: () => client.getMachine(appName, machineId),
    catch: toFlyApiError,
  });

/** List all machines in an app (Effect variant). */
export const listMachines = (
  client: FlyApiClient,
  appName: string,
): Effect.Effect<FlyMachine[], FlyApiError> =>
  Effect.tryPromise({
    try: () => client.listMachines(appName),
    catch: toFlyApiError,
  });

/** Execute a command inside a running machine (Effect variant). */
export const execCommand = (
  client: FlyApiClient,
  appName: string,
  machineId: string,
  command: string[],
  timeout?: number,
): Effect.Effect<FlyExecResult, FlyApiError> =>
  Effect.tryPromise({
    try: () => client.execCommand(appName, machineId, command, timeout),
    catch: toFlyApiError,
  });

/** Wait for a machine to reach a target state (Effect variant). */
export const waitForState = (
  client: FlyApiClient,
  appName: string,
  machineId: string,
  state: string,
  timeout?: number,
): Effect.Effect<void, FlyApiError> =>
  Effect.tryPromise({
    try: () => client.waitForState(appName, machineId, state, timeout),
    catch: toFlyApiError,
  });

/** Create a Fly app if it doesn't exist (Effect variant). */
export const ensureApp = (
  client: FlyApiClient,
  appName: string,
  orgSlug: string,
): Effect.Effect<void, FlyApiError> =>
  Effect.tryPromise({
    try: () => client.ensureApp(appName, orgSlug),
    catch: toFlyApiError,
  });
