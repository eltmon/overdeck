import type { Ora } from 'ora';
import { UnsafeSyncMainStateError } from '../../lib/cloister/sync-main-git.js';

const HEARTBEAT_INTERVAL_MS = 15_000;

type PrepSpinner = Pick<Ora, 'text'>;

type PrepOutputStream = {
  readonly isTTY?: boolean;
  write(chunk: string): unknown;
};

export interface PrepProgressOptions {
  stream?: PrepOutputStream;
}

export class PrepStepTimeoutError extends Error {
  constructor(
    public readonly stepName: string,
    public readonly budgetMs: number,
  ) {
    super(`Prep step '${stepName}' exceeded its ${formatSeconds(budgetMs)}s budget`);
    this.name = 'PrepStepTimeoutError';
  }
}

function formatSeconds(milliseconds: number): string {
  return String(milliseconds / 1_000);
}

export function createPrepProgress(
  spinner: PrepSpinner,
  options: PrepProgressOptions = {},
) {
  const stream = options.stream ?? process.stdout;
  const writesPlainLines = stream.isTTY !== true;

  function writeLine(text: string): void {
    if (writesPlainLines) {
      stream.write(`[prep] ${text}\n`);
    }
  }

  function update(text: string): void {
    spinner.text = text;
    writeLine(text);
  }

  async function step<T>(
    name: string,
    budgetMs: number,
    fn: (signal: AbortSignal) => Promise<T> | T,
    options: { awaitQuiescence?: boolean } = {},
  ): Promise<T> {
    const startedAt = Date.now();
    const controller = new AbortController();
    update(name);

    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1_000);
      writeLine(`still running: ${name} (${elapsedSeconds}s elapsed)`);
    }, HEARTBEAT_INTERVAL_MS);

    const operation = Promise.resolve().then(() => fn(controller.signal));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol('timed-out');
    const timeoutPromise = new Promise<typeof timedOut>((resolve) => {
      timeout = setTimeout(() => resolve(timedOut), budgetMs);
    });

    try {
      const value = await Promise.race([operation, timeoutPromise]);
      if (value === timedOut) {
        const error = new PrepStepTimeoutError(name, budgetMs);
        controller.abort(error);
        if (options.awaitQuiescence) await operation;
        else void operation.catch(() => undefined);
        throw error;
      }
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1_000);
      update(`completed: ${name} (${elapsedSeconds}s elapsed)`);
      return value;
    } finally {
      clearInterval(heartbeat);
      if (timeout) clearTimeout(timeout);
    }
  }

  return { update, step };
}

export const START_PREP_STEP_POLICIES = {
  'state-reconcile': { budgetMs: 60_000, timeout: 'fail-fast' },
  'sync-main': { budgetMs: 240_000, timeout: 'degrade' },
  'tracker-context': { budgetMs: 60_000, timeout: 'degrade' },
  spawn: { budgetMs: 600_000, timeout: 'fail-fast' },
} as const;

export type StartPrepStepName = keyof typeof START_PREP_STEP_POLICIES;

type PrepProgress = ReturnType<typeof createPrepProgress>;

export function createPlanningProgress(
  spinner: Pick<Ora, 'text'>,
  onComplete: (name: string) => void,
) {
  return {
    setSpinnerText: (text: string) => { spinner.text = text; },
    onComplete,
  };
}

export function warnSyncMainFailure(spinner: Pick<Ora, 'warn'>, error: unknown): void {
  if (error instanceof UnsafeSyncMainStateError) throw error;
  spinner.warn(`Sync main failed: ${error instanceof Error ? error.message : String(error)}`);
}

export async function runStateReconcile(
  prep: PrepProgress,
  spinner: Pick<Ora, 'warn'>,
  remote: boolean,
  reconcile: () => Promise<void> | void,
): Promise<void> {
  if (remote) await reconcile();
  else await runStartPrepStep(prep, spinner, 'state-reconcile', reconcile);
}

export async function runStartPrepStep<T>(
  prep: PrepProgress,
  spinner: Pick<Ora, 'warn'>,
  name: StartPrepStepName,
  fn: (signal: AbortSignal) => Promise<T> | T,
  timeoutFallback?: T,
): Promise<T> {
  const policy = START_PREP_STEP_POLICIES[name];
  try {
    return await prep.step(name, policy.budgetMs, fn, {
      awaitQuiescence: policy.timeout === 'degrade',
    });
  } catch (error) {
    if (error instanceof PrepStepTimeoutError && policy.timeout === 'degrade') {
      spinner.warn(error.message);
      return timeoutFallback as T;
    }
    throw error;
  }
}
