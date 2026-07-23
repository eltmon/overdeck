import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostHog } from 'posthog-node';
import type { TelemetryEventName, TelemetryPropertiesFor } from '@overdeck/contracts';
import { packageRoot } from '../paths.js';
import { resolveTelemetryEnabled } from './config.js';
import { getOrCreateInstallId } from './install-id.js';

const DEFAULT_POSTHOG_API_KEY = 'phc_pwvHeDutnCmAm8tZh5hRaQ7mMoho3T9gb4t4qRjK2Zjt';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const SHUTDOWN_TIMEOUT_MS = 2_000;
const FLAG_TIMEOUT_MS = 500;

export type AnalyticsClientType = 'cli' | 'server';

export interface AnalyticsServiceOptions {
  captureProcessExceptions?: boolean;
  fatalProcessExit?: (code: number) => never;
  featureFlagOverrides?: Readonly<Record<string, boolean>>;
}

export type TelemetryExceptionAction =
  | 'cli_command'
  | 'pipeline_transition'
  | 'server_boot'
  | 'uncaught_exception'
  | 'unhandled_rejection';

export interface TelemetryExceptionContext {
  action: TelemetryExceptionAction;
}

let cachedOverdeckVersion: string | undefined;
let processAnalyticsClientType: AnalyticsClientType = 'server';
const sharedAnalyticsServices = new Map<AnalyticsClientType, AnalyticsService>();
const pendingAnalyticsTasks = new Set<Promise<unknown>>();

function getOverdeckVersion(): string {
  if (cachedOverdeckVersion) return cachedOverdeckVersion;
  try {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown };
    cachedOverdeckVersion = typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    cachedOverdeckVersion = 'unknown';
  }
  return cachedOverdeckVersion;
}

function telemetryBlockedForProcess(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
}

export class AnalyticsService {
  private client: PostHog | undefined;
  private processExceptionHandlers: {
    uncaughtException: (error: Error) => void;
    unhandledRejection: (reason: unknown) => void;
  } | undefined;
  private fatalExceptionInFlight = false;

  constructor(
    private readonly clientType: AnalyticsClientType,
    private readonly options: AnalyticsServiceOptions = {},
  ) {}

  capture<Event extends TelemetryEventName>(
    event: Event,
    properties: TelemetryPropertiesFor<Event>,
  ): void {
    const client = this.getClient();
    if (!client) return;

    try {
      client.capture({
        distinctId: getOrCreateInstallId(),
        event,
        properties: {
          ...properties,
          $process_person_profile: false,
          platform: process.platform,
          arch: process.arch,
          overdeckVersion: getOverdeckVersion(),
          clientType: this.clientType,
        },
      });
    } catch {
      // Analytics must never fail the caller.
    }
  }

  captureException(_error: unknown, context: TelemetryExceptionContext): void {
    const client = this.getClient();
    if (!client) return;

    const sanitized = new Error(`Overdeck ${context.action} operation failed`);
    sanitized.name = 'OverdeckTelemetryException';
    sanitized.stack = undefined;

    try {
      client.captureException(
        sanitized,
        getOrCreateInstallId(),
        {
          action: context.action,
          $process_person_profile: false,
          platform: process.platform,
          arch: process.arch,
          overdeckVersion: getOverdeckVersion(),
          clientType: this.clientType,
        },
      );
    } catch {
      // Analytics must never fail the caller.
    }
  }

  async isFeatureEnabled(flag: string, fallback: boolean): Promise<boolean> {
    const override = this.options.featureFlagOverrides?.[flag];
    if (typeof override === 'boolean') return override;

    const client = this.getClient();
    if (!client) return fallback;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        client.isFeatureEnabled(flag, getOrCreateInstallId(), {
          sendFeatureFlagEvents: false,
        }),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(fallback), FLAG_TIMEOUT_MS);
        }),
      ]);
      return typeof result === 'boolean' ? result : fallback;
    } catch {
      return fallback;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async shutdown(timeoutMs = SHUTDOWN_TIMEOUT_MS): Promise<void> {
    this.detachProcessExceptionHandlers();
    const client = this.client;
    if (!client) return;
    this.client = undefined;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const shutdown = Promise.resolve(client.shutdown(Math.max(0, timeoutMs)));
      if (timeoutMs <= 0) return;
      await Promise.race([
        shutdown,
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs); }),
      ]);
    } catch {
      // Analytics must never fail shutdown.
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private attachProcessExceptionHandlers(): void {
    if (!this.options.captureProcessExceptions || this.processExceptionHandlers) return;
    const uncaughtException = (error: Error): void => {
      this.captureFatalProcessException(error, 'uncaught_exception');
    };
    const unhandledRejection = (reason: unknown): void => {
      this.captureFatalProcessException(reason, 'unhandled_rejection');
    };
    this.processExceptionHandlers = { uncaughtException, unhandledRejection };
    process.on('uncaughtException', uncaughtException);
    process.on('unhandledRejection', unhandledRejection);
  }

  private captureFatalProcessException(
    error: unknown,
    action: Extract<TelemetryExceptionAction, 'uncaught_exception' | 'unhandled_rejection'>,
  ): void {
    if (this.fatalExceptionInFlight) return;
    this.fatalExceptionInFlight = true;
    process.exitCode = 1;
    this.captureException(error, { action });
    void this.shutdown().finally(() => {
      const exit = this.options.fatalProcessExit ?? process.exit;
      exit(1);
    });
  }

  private detachProcessExceptionHandlers(): void {
    const handlers = this.processExceptionHandlers;
    if (!handlers) return;
    process.off('uncaughtException', handlers.uncaughtException);
    process.off('unhandledRejection', handlers.unhandledRejection);
    this.processExceptionHandlers = undefined;
  }

  private getClient(): PostHog | undefined {
    let enabled = false;
    try {
      enabled = !telemetryBlockedForProcess() && resolveTelemetryEnabled();
    } catch {
      // A configuration read failure must fail closed.
    }

    if (!enabled) {
      void this.shutdown();
      return undefined;
    }
    if (this.client) return this.client;

    try {
      this.client = new PostHog(
        process.env.POSTHOG_API_KEY ?? DEFAULT_POSTHOG_API_KEY,
        {
          host: process.env.POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
          enableExceptionAutocapture: false,
        },
      );
      this.attachProcessExceptionHandlers();
      return this.client;
    } catch {
      return undefined;
    }
  }
}

export function setAnalyticsClientTypeForProcess(clientType: AnalyticsClientType): void {
  processAnalyticsClientType = clientType;
}

export function getAnalyticsClientTypeForProcess(): AnalyticsClientType {
  return processAnalyticsClientType;
}

export function getAnalyticsService(clientType: AnalyticsClientType): AnalyticsService {
  const existing = sharedAnalyticsServices.get(clientType);
  if (existing) return existing;

  const analytics = new AnalyticsService(clientType, {
    captureProcessExceptions: clientType === 'server',
  });
  sharedAnalyticsServices.set(clientType, analytics);
  return analytics;
}

export function trackAnalyticsTask<Task extends Promise<unknown>>(task: Task): Task {
  pendingAnalyticsTasks.add(task);
  const remove = (): void => { pendingAnalyticsTasks.delete(task); };
  void task.then(remove, remove);
  return task;
}

async function waitForPendingAnalyticsTasks(timeoutMs: number): Promise<void> {
  if (pendingAnalyticsTasks.size === 0 || timeoutMs <= 0) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...pendingAnalyticsTasks]),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function shutdownAnalyticsServices(): Promise<void> {
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  await waitForPendingAnalyticsTasks(SHUTDOWN_TIMEOUT_MS);
  const remainingMs = Math.max(0, deadline - Date.now());
  await Promise.all(
    [...sharedAnalyticsServices.values()].map((analytics) =>
      analytics.shutdown(remainingMs)),
  );
}

export async function synchronizeAnalyticsServices(): Promise<void> {
  let enabled = false;
  try {
    enabled = resolveTelemetryEnabled();
  } catch {
    // A configuration read failure must fail closed.
  }
  if (enabled) return;
  await shutdownAnalyticsServices();
}
