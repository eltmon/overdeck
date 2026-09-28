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
  trackAnalyticsTask,
} from '../lib/telemetry/service.js';
import { maybeSendInstanceHeartbeat } from '../lib/telemetry/instance-heartbeat.js';
import { registerCliExitFinalizer } from './exit.js';
import { registerGitHubRateLimitedTelemetry } from '../lib/telemetry/github-quota-telemetry.js';
import { flushLedgerWrites } from '../lib/github-quota/ledger.js';

export { exitCli } from './exit.js';

setAnalyticsClientTypeForProcess('cli');
// PAN-4264: a CLI process that records a GitHub rate-limit refusal reports it too.
registerGitHubRateLimitedTelemetry();

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

  private readonly heartbeat: (() => Promise<unknown>) | undefined;

  constructor(
    analytics?: Pick<AnalyticsService, 'capture' | 'shutdown'>,
    private readonly startedAt = Date.now(),
    heartbeat?: () => Promise<unknown>,
  ) {
    this.analytics = analytics ?? getAnalyticsService('cli');
    this.shutdown = analytics
      ? () => analytics.shutdown()
      : shutdownAnalyticsServices;
    // PAN-4264: the daily instance_heartbeat (dashboard_running: false). An
    // injected analytics client gets none unless the caller passes one.
    this.heartbeat = heartbeat ?? (analytics ? undefined : async () => {
      // Loaded on first use to keep projects.ts out of the CLI startup graph.
      const { listProjectsSync } = await import('../lib/projects.js');
      return maybeSendInstanceHeartbeat({
        dashboardRunning: false,
        listProjects: listProjectsSync,
        listAgents: () => [],
        analytics: this.analytics,
      });
    });
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
    // Tracked, not awaited: shutdownAnalyticsServices waits for it within its deadline.
    if (this.heartbeat) void trackAnalyticsTask(this.heartbeat());
    // PAN-4264: GitHub quota ledger lines are queued, not awaited; land them
    // before the process exits (every CLI exit path finishes here).
    await flushLedgerWrites();
    await this.shutdown();
  }
}

export class CliProcessLifecycle {
  private finishPromise: Promise<void> | undefined;

  constructor(
    private readonly telemetry: Pick<CliTelemetryLifecycle, 'finish'>,
    private readonly drain: () => Promise<void>,
  ) {}

  finish(ok: boolean): Promise<void> {
    this.finishPromise ??= this.finishOnce(ok);
    return this.finishPromise;
  }

  private async finishOnce(ok: boolean): Promise<void> {
    try {
      await this.drain();
    } finally {
      await this.telemetry.finish(ok);
    }
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
  const lifecycle = new CliProcessLifecycle(cliTelemetry, drain);
  registerCliExitFinalizer((code) => lifecycle.finish(code === 0));
  try {
    await run();
    await lifecycle.finish(Number(process.exitCode ?? 0) === 0);
  } catch (error) {
    await lifecycle.finish(false);
    throw error;
  }
}
