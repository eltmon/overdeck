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
