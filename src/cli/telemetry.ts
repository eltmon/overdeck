import {
  TELEMETRY_CLI_VERBS,
  type TelemetryCliVerb,
  type TelemetryDurationBucket,
} from '@overdeck/contracts';
import { AnalyticsService } from '../lib/telemetry/service.js';

const TELEMETRY_CLI_VERB_SET = new Set<string>(TELEMETRY_CLI_VERBS);
type ProcessExitCode = Parameters<NodeJS.Process['exit']>[0];

class CliExitRequest extends Error {
  constructor(readonly code: ProcessExitCode) {
    super('CLI exit requested');
  }
}

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
  private finished = false;

  constructor(
    private readonly analytics: Pick<AnalyticsService, 'capture' | 'shutdown'> =
      new AnalyticsService('cli'),
    private readonly startedAt = Date.now(),
  ) {}

  async finish(ok: boolean, argv = process.argv, finishedAt = Date.now()): Promise<void> {
    if (this.finished) return;
    this.finished = true;

    this.analytics.capture('cli_command_run', {
      verb: resolveTelemetryCliVerb(argv),
      ok,
      duration_ms: bucketCliDuration(Math.max(0, finishedAt - this.startedAt)),
    });
    await this.analytics.shutdown();
  }
}

const cliTelemetry = new CliTelemetryLifecycle();

export async function exitAfterTelemetry(
  code: number,
  telemetry: CliTelemetryLifecycle,
  exit: (code: number) => never = (exitCode) => process.exit(exitCode),
): Promise<never> {
  await telemetry.finish(code === 0);
  return exit(code);
}

export async function exitCli(code: number): Promise<never> {
  return exitAfterTelemetry(code, cliTelemetry);
}

export async function runCliWithTelemetry(
  run: () => Promise<unknown>,
  drain: () => Promise<void>,
  exit: (code: ProcessExitCode) => never = (code) => process.exit(code),
  telemetry: CliTelemetryLifecycle = cliTelemetry,
): Promise<void> {
  const originalExit = process.exit;
  let exitRequest: CliExitRequest | undefined;
  process.exit = ((code?: ProcessExitCode): never => {
    throw new CliExitRequest(code);
  }) as NodeJS.Process['exit'];

  try {
    try {
      await run();
      await telemetry.finish(Number(process.exitCode ?? 0) === 0);
    } catch (error) {
      if (error instanceof CliExitRequest) {
        exitRequest = error;
        await telemetry.finish(Number(error.code ?? process.exitCode ?? 0) === 0);
      } else {
        await telemetry.finish(false);
        throw error;
      }
    } finally {
      await drain();
    }
  } finally {
    process.exit = originalExit;
  }

  if (exitRequest) return exit(exitRequest.code ?? process.exitCode ?? 0);
}
