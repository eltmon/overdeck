import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import { BdTransientFailure, runBdWithRetry, type RunBdWithRetryOptions } from '../bd-process-lock.js';

const execFileAsync = promisify(execFile);

export interface BeadRecord {
  id: string;
  title: string;
  status: string;
  labels: string[];
  [key: string]: unknown;
}

export type BeadsReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; transient: boolean; error: unknown };

export type BdReadExecutor = (args: string[], cwd: string) => Promise<string>;

export interface BeadsResolverOptions {
  execute?: BdReadExecutor;
  retry?: Omit<RunBdWithRetryOptions, 'workspacePath'>;
}

function normalizeRecord(value: unknown): BeadRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  return {
    ...record,
    id: record.id,
    title: typeof record.title === 'string' ? record.title : '',
    status: typeof record.status === 'string' ? record.status : 'open',
    labels: Array.isArray(record.labels) ? record.labels.filter((label): label is string => typeof label === 'string') : [],
  };
}

function parseRecords(stdout: string): BeadRecord[] {
  const parsed: unknown = JSON.parse(stdout || '[]');
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.map(normalizeRecord).filter((record): record is BeadRecord => record !== null);
}

async function defaultExecute(args: string[], cwd: string): Promise<string> {
  // 64MB buffer: bulk reads (getAllBeads on a 3k+-bead project) exceed Node's
  // 1MB execFile default, which surfaces as maxBuffer errors + retry thrash.
  const { stdout } = await execFileAsync('bd', args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  return typeof stdout === 'string' ? stdout : String((stdout as unknown as { stdout?: string }).stdout ?? stdout);
}

export class BeadsResolver {
  readonly #workspacePath: string;
  readonly #execute: BdReadExecutor;
  readonly #retry: Omit<RunBdWithRetryOptions, 'workspacePath'>;

  constructor(workspacePath: string, options: BeadsResolverOptions = {}) {
    this.#workspacePath = workspacePath;
    this.#execute = options.execute ?? defaultExecute;
    this.#retry = options.retry ?? {};
  }

  async #read(operation: string, args: string[]): Promise<BeadsReadResult<BeadRecord[]>> {
    try {
      const stdout = await runBdWithRetry(
        operation,
        () => this.#execute(args, this.#workspacePath),
        { ...this.#retry, workspacePath: this.#workspacePath },
      );
      return { ok: true, value: parseRecords(stdout) };
    } catch (error) {
      return {
        ok: false,
        reason: `The canonical beads database could not answer "${operation}"; bead state is stale, not empty.`,
        transient: error instanceof BdTransientFailure,
        error,
      };
    }
  }

  getBeadsForIssue(issueId: string): Promise<BeadsReadResult<BeadRecord[]>> {
    return this.#read(`query beads for ${issueId}`, ['list', '--json', '-l', issueId.toLowerCase(), '--status', 'all', '--limit', '0']);
  }

  getBeadsForIssueSync(issueId: string): BeadsReadResult<BeadRecord[]> {
    try {
      const stdout = execFileSync('bd', ['list', '--json', '-l', issueId.toLowerCase(), '--status', 'all', '--limit', '0'], {
        cwd: this.#workspacePath,
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { ok: true, value: parseRecords(stdout) };
    } catch (error) {
      return { ok: false, reason: 'The canonical beads database could not answer the synchronous issue query; bead state is stale, not empty.', transient: false, error };
    }
  }

  getReadyBeads(): Promise<BeadsReadResult<BeadRecord[]>> {
    return this.#read('query ready beads', ['ready', '--json', '--limit', '0']);
  }

  getAllBeads(): Promise<BeadsReadResult<BeadRecord[]>> {
    return this.#read('query all beads', ['list', '--json', '--status', 'all', '--limit', '0']);
  }

  async getBeadById(beadId: string): Promise<BeadsReadResult<BeadRecord | null>> {
    const result = await this.#read(`query bead ${beadId}`, ['show', beadId, '--json']);
    return result.ok ? { ok: true, value: result.value[0] ?? null } : result;
  }

  async countBeadsForIssue(issueId: string): Promise<BeadsReadResult<number>> {
    const result = await this.getBeadsForIssue(issueId);
    return result.ok ? { ok: true, value: result.value.length } : result;
  }

  async issueHasBeads(issueId: string): Promise<BeadsReadResult<boolean>> {
    const result = await this.countBeadsForIssue(issueId);
    return result.ok ? { ok: true, value: result.value > 0 } : result;
  }
}

export function createBeadsResolver(workspacePath: string, options: BeadsResolverOptions = {}): BeadsResolver {
  return new BeadsResolver(workspacePath, options);
}
