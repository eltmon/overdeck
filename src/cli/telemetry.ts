import {
  TELEMETRY_CLI_VERBS,
  type TelemetryCliVerb,
  type TelemetryDurationBucket,
} from '@overdeck/contracts';
import {
  AnalyticsService,
  getAnalyticsService,
  setAnalyticsClientTypeForProcess,
  shutdownAnalyticsServices,
} from '../lib/telemetry/service.js';
import { registerCliExitFinalizer } from './exit.js';

export { exitCli } from './exit.js';

setAnalyticsClientTypeForProcess('cli');

const TELEMETRY_CLI_VERB_SET = new Set<string>(TELEMETRY_CLI_VERBS);

export function bucketCliDuration(durationMs: number): TelemetryDurationBucket {
  if (durationMs < 100) return 'under_100ms';
  if (durationMs < 1_000) return '100ms-999ms';
  if (durationMs < 10_000) return '1s-9s';
  return '10s+';
}

export function resolveTelemetryCliVerb(argv: readonly string[]): TelemetryCliVerb {
  const verb = argv[2];
  return verb && TELEMETRY_CLI_VERB_SET.has(verb)
    ? verb as TelemetryCliVerb
    : 'other';
}

export class CliTelemetryLifecycle {
  private finishPromise: Promise<void> | undefined;
  private readonly analytics: Pick<AnalyticsService, 'capture' | 'shutdown'>;
  private readonly shutdown: () => Promise<void>;

  constructor(
    analytics?: Pick<AnalyticsService, 'capture' | 'shutdown'>,
    private readonly startedAt = Date.now(),
  ) {
    this.analytics = analytics ?? getAnalyticsService('cli');
    this.shutdown = analytics
      ? () => analytics.shutdown()
      : shutdownAnalyticsServices;
  }

  finish(ok: boolean, argv = process.argv, finishedAt = Date.now()): Promise<void> {
    this.finishPromise ??= this.finishOnce(ok, argv, finishedAt);
    return this.finishPromise;
  }

  private async finishOnce(ok: boolean, argv: readonly string[], finishedAt: number): Promise<void> {
    this.analytics.capture('cli_command_run', {
      verb: resolveTelemetryCliVerb(argv),
      ok,
      duration_ms: bucketCliDuration(Math.max(0, finishedAt - this.startedAt)),
    });
    await this.shutdown();
  }
}

const cliTelemetry = new CliTelemetryLifecycle();
registerCliExitFinalizer((code) => cliTelemetry.finish(code === 0));

export async function exitAfterTelemetry(
  code: number,
  telemetry: CliTelemetryLifecycle,
  exit: (code: number) => never = (exitCode) => process.exit(exitCode),
): Promise<never> {
  await telemetry.finish(code === 0);
  return exit(code);
}

export async function runCliWithTelemetry(
  run: () => Promise<unknown>,
  drain: () => Promise<void>,
): Promise<void> {
  try {
    await run();
    await cliTelemetry.finish(Number(process.exitCode ?? 0) === 0);
  } catch (error) {
    await cliTelemetry.finish(false);
    throw error;
  } finally {
    await drain();
  }
}
