import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface, type Interface } from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MINIMUM_CODEX_VERSION = '0.144.0';
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const VERSION_TIMEOUT_MS = 4_000;

export interface AppServerMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: unknown };
}

export interface CodexAppServerManagerOptions {
  codexBinary?: string;
  cwd: string;
  codexHome?: string;
  requestTimeoutMs?: number;
  clientVersion?: string;
  spawnProcess?: () => ChildProcessWithoutNullStreams;
  readVersion?: () => Promise<string>;
}

interface PendingRequest {
  method: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class CodexAppServerManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private output: Interface | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly options: CodexAppServerManagerOptions) {
    super();
  }

  async start(): Promise<void> {
    if (this.child) return;
    await this.assertSupportedVersion();

    const binary = this.options.codexBinary ?? 'codex';
    const child = this.options.spawnProcess?.() ?? spawn(binary, ['app-server'], {
      cwd: this.options.cwd,
      env: { ...process.env, ...(this.options.codexHome ? { CODEX_HOME: this.options.codexHome } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.output.on('line', line => this.handleLine(line));
    child.stderr.on('data', chunk => this.handleStderr(String(chunk)));
    child.once('exit', (code, signal) => this.handleExit(code, signal));

    await this.request('initialize', {
      clientInfo: {
        name: 'overdeck',
        title: 'Overdeck',
        version: this.options.clientVersion ?? '0.0.0',
      },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized');
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      this.pending.set(String(id), { method, timeout, resolve: value => resolve(value as T), reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  stop(): void {
    this.output?.close();
    this.child?.kill('SIGTERM');
    this.child = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('codex app-server stopped.'));
    }
    this.pending.clear();
  }

  private async assertSupportedVersion(): Promise<void> {
    const raw = await (this.options.readVersion?.() ?? execFileAsync(this.options.codexBinary ?? 'codex', ['--version'], {
      cwd: this.options.cwd,
      timeout: VERSION_TIMEOUT_MS,
    }).then(result => result.stdout));
    const installed = raw.match(/\d+\.\d+\.\d+/)?.[0];
    if (!installed) throw new Error(`Could not parse Codex CLI version from: ${raw.trim()}`);
    if (compareVersions(installed, MINIMUM_CODEX_VERSION) < 0) {
      throw new Error(`Codex CLI ${installed} is unsupported; upgrade to ${MINIMUM_CODEX_VERSION} or newer.`);
    }
  }

  private handleLine(line: string): void {
    let message: AppServerMessage;
    try {
      message = JSON.parse(line) as AppServerMessage;
    } catch {
      this.emit('warning', `Ignoring invalid codex app-server JSON: ${line}`);
      return;
    }
    if (message.method && message.id !== undefined) {
      this.emit('request', message);
    } else if (message.method) {
      this.emit('notification', message);
    } else if (message.id !== undefined) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(String(message.id));
      if (message.error?.message) pending.reject(new Error(`${pending.method} failed: ${String(message.error.message)}`));
      else pending.resolve(message.result);
    }
  }

  private handleStderr(value: string): void {
    const clean = stripAnsi(value).trim();
    if (!clean || /state db missing rollout path for thread|find_thread_path_by_id_str_in_subdir/i.test(clean)) return;
    if (/\bERROR\b/i.test(clean)) this.emit('stderr', clean);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = undefined;
    this.emit('exit', { code, signal });
  }

  private write(message: AppServerMessage): void {
    if (!this.child?.stdin.writable) throw new Error('Cannot write to codex app-server stdin.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[@-_]/g, '');
}
