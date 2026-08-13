import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

export class PrimeAgentResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrimeAgentResumeError';
  }
}

export interface PrimeAgentResumeProcess {
  getState(): Promise<{ sessionId?: string }>;
  stop(): Promise<void>;
}

export interface ResumePrimeAgentSessionOptions {
  sessionId: string;
  sessionPath: string;
  start: (sessionPath: string) => Promise<PrimeAgentResumeProcess>;
  accessFile?: (path: string) => Promise<void>;
}

/** Start a resumed client only after the durable session exists, then verify identity. */
export async function resumePrimeAgentSession(options: ResumePrimeAgentSessionOptions): Promise<PrimeAgentResumeProcess> {
  const accessFile = options.accessFile ?? ((path: string) => access(path, constants.R_OK));
  try {
    await accessFile(options.sessionPath);
  } catch {
    throw new PrimeAgentResumeError(
      `Prime Agent session ${options.sessionId} cannot resume because ${options.sessionPath} is missing or unreadable. No fresh session was created.`,
    );
  }

  const process = await options.start(options.sessionPath);
  try {
    const state = await process.getState();
    if (state.sessionId !== options.sessionId) {
      throw new PrimeAgentResumeError(
        `Prime Agent resume returned session ${state.sessionId ?? '<missing>'}, expected ${options.sessionId}. The replacement process was stopped; no fresh session was accepted.`,
      );
    }
    return process;
  } catch (cause) {
    await process.stop().catch(() => undefined);
    if (cause instanceof PrimeAgentResumeError) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new PrimeAgentResumeError(
      `Prime Agent session ${options.sessionId} failed its resume verification: ${message}. The replacement process was stopped.`,
    );
  }
}
