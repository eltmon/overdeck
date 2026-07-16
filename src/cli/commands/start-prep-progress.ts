import type { Ora } from 'ora';

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
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const startedAt = Date.now();
    update(name);

    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1_000);
      writeLine(`still running: ${name} (${elapsedSeconds}s elapsed)`);
    }, HEARTBEAT_INTERVAL_MS);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new PrepStepTimeoutError(name, budgetMs));
      }, budgetMs);
    });

    try {
      const value = await Promise.race([
        Promise.resolve().then(fn),
        timeoutPromise,
      ]);
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

export async function runStartPrepStep<T>(
  prep: PrepProgress,
  spinner: Pick<Ora, 'warn'>,
  name: StartPrepStepName,
  fn: () => Promise<T> | T,
  timeoutFallback?: T,
): Promise<T> {
  const policy = START_PREP_STEP_POLICIES[name];
  try {
    return await prep.step(name, policy.budgetMs, fn);
  } catch (error) {
    if (error instanceof PrepStepTimeoutError && policy.timeout === 'degrade') {
      spinner.warn(error.message);
      return timeoutFallback as T;
    }
    throw error;
  }
}
