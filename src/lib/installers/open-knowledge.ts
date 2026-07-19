import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

const OPEN_KNOWLEDGE_PACKAGE = '@inkeep/open-knowledge';
const MANUAL_INSTALL_COMMAND = `npm install -g ${OPEN_KNOWLEDGE_PACKAGE}`;

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
export type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface EnsureOpenKnowledgeOptions {
  autoInstall?: boolean;
  retryDelayMs?: number;
  maxHealthAttempts?: number;
  runCommand?: CommandRunner;
  installOpenKnowledge?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export interface EnsureOpenKnowledgeResult {
  status: 'already-installed' | 'installed';
  command: 'ok';
}

export interface StartOpenKnowledgeServerOptions {
  apiPort?: number;
  uiPort?: number;
  host?: string;
  mode?: 'browser' | 'app';
  openBrowser?: boolean;
  initializeIfNeeded?: boolean;
  runCommand?: CommandRunner;
  spawnProcess?: SpawnProcess;
  isInitialized?: (bundlePath: string) => Promise<boolean>;
  getAvailablePorts?: (count: number, host: string) => Promise<number[]>;
}

export interface StartOpenKnowledgeServerResult {
  process: ChildProcess;
  port: number;
  apiPort: number;
  url: string;
}

export class OpenKnowledgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenKnowledgeError';
  }
}

export async function ensureOpenKnowledge(
  options: EnsureOpenKnowledgeOptions = {},
): Promise<EnsureOpenKnowledgeResult> {
  const runCommand = options.runCommand ?? runCommandWithSpawn;

  if (await openKnowledgeBinaryWorks(runCommand)) {
    return { status: 'already-installed', command: 'ok' };
  }

  if (!options.autoInstall) {
    throw new OpenKnowledgeError(`open-knowledge is not installed. Install it manually with \`${MANUAL_INSTALL_COMMAND}\`.`);
  }

  try {
    await (options.installOpenKnowledge ?? (() => installOpenKnowledgeWithNpm(runCommand)))();
  } catch (error) {
    throw await installationError(error, runCommand);
  }

  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelayMs = options.retryDelayMs ?? 500;
  const maxHealthAttempts = options.maxHealthAttempts ?? 10;

  for (let attempt = 1; attempt <= maxHealthAttempts; attempt += 1) {
    if (await openKnowledgeBinaryWorks(runCommand)) {
      return { status: 'installed', command: 'ok' };
    }
    if (attempt < maxHealthAttempts) await sleep(retryDelayMs);
  }

  throw await installationError(new Error('the ok binary did not pass `ok --version` after installation'), runCommand);
}

export async function startOpenKnowledgeServer(
  bundlePath: string,
  options: StartOpenKnowledgeServerOptions = {},
): Promise<StartOpenKnowledgeServerResult> {
  const runCommand = options.runCommand ?? runCommandWithSpawn;
  const isInitialized = options.isInitialized ?? openKnowledgeIsInitialized;

  if (!(await isInitialized(bundlePath))) {
    if (options.initializeIfNeeded === false) {
      throw new OpenKnowledgeError(`open-knowledge is not initialized for ${bundlePath}. Run \`ok init\` first.`);
    }
    await runCommand('ok', [
      '--cwd',
      bundlePath,
      'init',
      '--no-mcp',
      '--no-skills',
      '--local-only',
      '--content-dir',
      '.',
      '--json',
    ]);
  }

  const host = options.host ?? '127.0.0.1';
  const missingPortCount = Number(options.apiPort === undefined) + Number(options.uiPort === undefined);
  const availablePorts = missingPortCount > 0
    ? await (options.getAvailablePorts ?? findAvailablePorts)(missingPortCount, host)
    : [];
  const apiPort = options.apiPort ?? availablePorts.shift();
  const uiPort = options.uiPort ?? availablePorts.shift();

  if (apiPort === undefined || uiPort === undefined || apiPort === uiPort) {
    throw new OpenKnowledgeError('Could not allocate distinct API and UI ports for open-knowledge.');
  }

  const args = [
    '--cwd',
    bundlePath,
    'start',
    '--port',
    String(apiPort),
    '--ui-port',
    String(uiPort),
    '--host',
    host,
    '--mode',
    options.mode ?? 'browser',
  ];
  if (options.openBrowser) args.push('--open');

  const spawnProcess = options.spawnProcess ?? ((command, commandArgs, spawnOptions) => spawn(command, commandArgs, spawnOptions));
  const child = spawnProcess('ok', args, { stdio: 'ignore' });
  await waitForSpawn(child);

  return {
    process: child,
    port: uiPort,
    apiPort,
    url: `http://${formatUrlHost(host)}:${uiPort}`,
  };
}

async function openKnowledgeBinaryWorks(runCommand: CommandRunner): Promise<boolean> {
  try {
    await runCommand('ok', ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function installOpenKnowledgeWithNpm(runCommand: CommandRunner): Promise<void> {
  await runCommand('npm', ['install', '-g', OPEN_KNOWLEDGE_PACKAGE]);
}

async function installationError(error: unknown, runCommand: CommandRunner): Promise<OpenKnowledgeError> {
  const version = await readNodeVersion(runCommand);
  const major = version ? Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10) : Number.NaN;

  if (version && Number.isFinite(major) && major < 24) {
    return new OpenKnowledgeError(
      `open-knowledge requires Node 24+; found ${version}. Install Node 24+ or run '/okf open --no-install' after installing manually.`,
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new OpenKnowledgeError(`Failed to install open-knowledge with \`${MANUAL_INSTALL_COMMAND}\`: ${detail}`);
}

async function readNodeVersion(runCommand: CommandRunner): Promise<string | null> {
  try {
    const result = await runCommand('node', ['--version']);
    return result.stdout.trim() || result.stderr.trim() || null;
  } catch {
    return null;
  }
}

async function openKnowledgeIsInitialized(bundlePath: string): Promise<boolean> {
  try {
    await access(join(bundlePath, '.ok', 'config.yml'));
    return true;
  } catch {
    return false;
  }
}

async function findAvailablePorts(count: number, host: string): Promise<number[]> {
  const servers = Array.from({ length: count }, () => createServer());
  try {
    return await Promise.all(servers.map((server) => new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new OpenKnowledgeError('Could not resolve an available open-knowledge port.'));
          return;
        }
        resolve(address.port);
      });
    })));
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    })));
  }
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      child.removeListener('spawn', onSpawn);
      reject(error);
    };
    const onSpawn = () => {
      child.removeListener('error', onError);
      resolve();
    };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

async function runCommandWithSpawn(command: string, args: string[]): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new OpenKnowledgeError(`${command} ${args.join(' ')} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function formatUrlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
