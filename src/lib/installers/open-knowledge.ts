import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir as osHomedir } from 'node:os';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import { getOverdeckHome } from '../paths.js';
import {
  resolveNode24Runtime,
  writeOkShim,
  type NodeRuntimeListDir,
  type NodeRuntimeSource,
  type NodeVersionManager,
  type ResolveNode24RuntimeOptions,
  type WriteOkShimOptions,
} from './node-runtime.js';

const OPEN_KNOWLEDGE_PACKAGE = '@inkeep/open-knowledge';
const MANUAL_INSTALL_COMMAND = `npm install -g ${OPEN_KNOWLEDGE_PACKAGE}`;
const DEFAULT_START_RETRY_DELAY_MS = 250;
const DEFAULT_START_MAX_ATTEMPTS = 40;
const NVM_INSTALL_COMMAND = "PROFILE=/dev/null bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash'";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], options?: SpawnOptions) => Promise<CommandResult>;
export type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type OpenKnowledgeSetupPlan =
  | { kind: 'ready'; command: string }
  | { kind: 'install-under-runtime'; source: NodeRuntimeSource; nodePath: string; steps: string[] }
  | { kind: 'install-node-via-manager'; manager: NodeVersionManager; installCommand: string; steps: string[] }
  | { kind: 'install-nvm'; steps: string[]; manualCommand: string };

export interface OpenKnowledgeSetupOptions {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  listDir?: NodeRuntimeListDir;
  runCommand?: CommandRunner;
  shimPath?: string;
  realpath?: typeof realpath;
  resolveRuntime?: (options: ResolveNode24RuntimeOptions) => ReturnType<typeof resolveNode24Runtime>;
  writeShim?: (options: WriteOkShimOptions) => Promise<string>;
}

export interface EnsureOpenKnowledgeOptions extends OpenKnowledgeSetupOptions {
  autoInstall?: boolean;
  retryDelayMs?: number;
  maxHealthAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  resolveSetupPlan?: () => Promise<OpenKnowledgeSetupPlan>;
  executeSetupPlan?: (plan: OpenKnowledgeSetupPlan) => Promise<string>;
}

export interface EnsureOpenKnowledgeResult {
  status: 'already-installed' | 'installed';
  command: string;
}

export interface OpenKnowledgeProcessStatus {
  name: string;
  state: string;
  alive: boolean;
  pid?: number;
  port?: number;
}

export interface OpenKnowledgeStatus {
  server: OpenKnowledgeProcessStatus;
  ui: OpenKnowledgeProcessStatus;
}

export interface StartOpenKnowledgeServerOptions {
  apiPort?: number;
  uiPort?: number;
  host?: string;
  mode?: 'browser' | 'app';
  openBrowser?: boolean;
  initializeIfNeeded?: boolean;
  retryDelayMs?: number;
  maxHealthAttempts?: number;
  okCommand?: string;
  runCommand?: CommandRunner;
  spawnProcess?: SpawnProcess;
  isInitialized?: (bundlePath: string) => Promise<boolean>;
  getAvailablePorts?: (count: number, host: string) => Promise<number[]>;
  getStatus?: (bundlePath: string) => Promise<OpenKnowledgeStatus>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface StartReadOnlyOpenKnowledgeServerOptions extends StartOpenKnowledgeServerOptions {
  snapshotRoot?: string;
  prepareSnapshot?: (bundlePath: string, snapshotRoot?: string) => Promise<string>;
}

export interface StartOpenKnowledgeServerResult {
  process: ChildProcess | null;
  owned: boolean;
  reused: boolean;
  port: number;
  apiPort: number;
  url: string;
  runtimeBundlePath: string;
}

export class OpenKnowledgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenKnowledgeError';
  }
}

export class OpenKnowledgeSetupRequiredError extends OpenKnowledgeError {
  constructor(public readonly plan: Extract<OpenKnowledgeSetupPlan, { kind: 'install-node-via-manager' | 'install-nvm' }>) {
    super(plan.steps.join(' '));
    this.name = 'OpenKnowledgeSetupRequiredError';
  }
}

export async function ensureOpenKnowledge(
  options: EnsureOpenKnowledgeOptions = {},
): Promise<EnsureOpenKnowledgeResult> {
  const runCommand = options.runCommand ?? runCommandWithSpawn;
  const shimPath = resolveShimPath(options);
  const existingCommand = await findExistingOpenKnowledgeCommand(runCommand, shimPath);

  if (existingCommand) {
    return { status: 'already-installed', command: existingCommand };
  }

  if (!options.autoInstall) {
    throw new OpenKnowledgeError(`open-knowledge is not installed. Install it manually with \`${MANUAL_INSTALL_COMMAND}\`.`);
  }

  const plan = await (options.resolveSetupPlan ?? (() => resolveOpenKnowledgeInstallPlan({ ...options, runCommand })))();
  if (plan.kind === 'ready') {
    return { status: 'already-installed', command: plan.command };
  }
  if (plan.kind === 'install-node-via-manager' || plan.kind === 'install-nvm') {
    throw new OpenKnowledgeSetupRequiredError(plan);
  }

  let command: string;
  try {
    command = await (options.executeSetupPlan ?? ((setupPlan) =>
      executeOpenKnowledgeSetupPlan(setupPlan, { ...options, runCommand })))(plan);
  } catch (error) {
    throw await installationError(error, runCommand);
  }

  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelayMs = options.retryDelayMs ?? 500;
  const maxHealthAttempts = options.maxHealthAttempts ?? 10;

  for (let attempt = 1; attempt <= maxHealthAttempts; attempt += 1) {
    if (await openKnowledgeBinaryWorks(command, runCommand)) {
      return { status: 'installed', command };
    }
    if (attempt < maxHealthAttempts) await sleep(retryDelayMs);
  }

  throw await installationError(
    new Error(`the ok binary did not pass \`${command} --version\` after installation`),
    runCommand,
  );
}

export async function resolveOpenKnowledgeSetupPlan(
  options: OpenKnowledgeSetupOptions = {},
): Promise<OpenKnowledgeSetupPlan> {
  const runCommand = options.runCommand ?? runCommandWithSpawn;
  const existingCommand = await findExistingOpenKnowledgeCommand(runCommand, resolveShimPath(options));
  if (existingCommand) return { kind: 'ready', command: existingCommand };
  return resolveOpenKnowledgeInstallPlan({ ...options, runCommand });
}

export async function executeOpenKnowledgeSetupPlan(
  plan: OpenKnowledgeSetupPlan,
  options: OpenKnowledgeSetupOptions = {},
): Promise<string> {
  const runCommand = options.runCommand ?? runCommandWithSpawn;

  if (plan.kind === 'ready') return plan.command;
  if (plan.kind === 'install-under-runtime') {
    return installOpenKnowledgeUnderRuntime(plan.nodePath, { ...options, runCommand });
  }

  const installCommand = plan.kind === 'install-nvm' ? NVM_INSTALL_COMMAND : plan.installCommand;
  await runCommand('bash', ['-c', installCommand]);

  const nextPlan = await resolveOpenKnowledgeInstallPlan({ ...options, runCommand });
  if (nextPlan.kind === plan.kind) {
    throw new OpenKnowledgeError(`Setup command completed but did not make a Node 24 runtime available: ${installCommand}`);
  }
  return executeOpenKnowledgeSetupPlan(nextPlan, { ...options, runCommand });
}

export async function startReadOnlyOpenKnowledgeServer(
  bundlePath: string,
  options: StartReadOnlyOpenKnowledgeServerOptions = {},
): Promise<StartOpenKnowledgeServerResult> {
  const prepareSnapshot = options.prepareSnapshot ?? prepareOpenKnowledgeSnapshot;
  const runtimeBundlePath = await readOnlyOpenKnowledgeSnapshotPath(bundlePath, options.snapshotRoot);
  const getStatus = options.getStatus ?? ((path) => getOpenKnowledgeStatus(path, options.runCommand, options.okCommand));
  const existing = await getStatus(runtimeBundlePath);
  if (!liveStatus(existing)) {
    await prepareSnapshot(bundlePath, options.snapshotRoot);
  }
  return startOpenKnowledgeServer(runtimeBundlePath, { ...options, getStatus });
}

export async function prepareOpenKnowledgeSnapshot(
  bundlePath: string,
  snapshotRoot = join(getOverdeckHome(), 'cache', 'knowledge-viewer'),
): Promise<string> {
  const source = await realpath(bundlePath);
  const destination = await readOnlyOpenKnowledgeSnapshotPath(source, snapshotRoot);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporaryRoot = await mkdtemp(join(parent, '.snapshot-'));
  const temporaryBundle = join(temporaryRoot, 'bundle');

  try {
    await cp(source, temporaryBundle, {
      recursive: true,
      dereference: true,
      filter: (path) => {
        const relativePath = relative(source, path);
        if (!relativePath) return true;
        const firstSegment = relativePath.split(sep)[0];
        return firstSegment !== '.git' && firstSegment !== '.ok';
      },
    });
    await runCommandWithSpawn('git', ['init', '--quiet', temporaryBundle]);
    await rm(destination, { recursive: true, force: true });
    await rename(temporaryBundle, destination);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  return destination;
}

export async function readOnlyOpenKnowledgeSnapshotPath(
  bundlePath: string,
  snapshotRoot = join(getOverdeckHome(), 'cache', 'knowledge-viewer'),
): Promise<string> {
  let resolved = bundlePath;
  try {
    resolved = await realpath(bundlePath);
  } catch {
    // A not-yet-created snapshot still has a stable path derived from its source string.
  }
  const key = createHash('sha256').update(resolved).digest('hex').slice(0, 24);
  return join(snapshotRoot, key, 'bundle');
}

export async function getOpenKnowledgeStatus(
  bundlePath: string,
  runCommand: CommandRunner = runCommandWithSpawn,
  okCommand = 'ok',
): Promise<OpenKnowledgeStatus> {
  try {
    const result = await runCommand(okCommand, ['--cwd', bundlePath, 'status', '--json']);
    const parsed = JSON.parse(result.stdout) as Partial<OpenKnowledgeStatus>;
    return {
      server: normalizeProcessStatus(parsed.server, 'server'),
      ui: normalizeProcessStatus(parsed.ui, 'ui'),
    };
  } catch {
    return missingStatus();
  }
}

export async function startOpenKnowledgeServer(
  bundlePath: string,
  options: StartOpenKnowledgeServerOptions = {},
): Promise<StartOpenKnowledgeServerResult> {
  const runCommand = options.runCommand ?? runCommandWithSpawn;
  const okCommand = options.okCommand ?? 'ok';
  const getStatus = options.getStatus ?? ((path) => getOpenKnowledgeStatus(path, runCommand, okCommand));
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_START_RETRY_DELAY_MS;
  const maxHealthAttempts = options.maxHealthAttempts ?? DEFAULT_START_MAX_ATTEMPTS;
  const existing = await getStatus(bundlePath);
  const reused = await readyResult(existing, options.host ?? '127.0.0.1', fetchImpl);
  if (reused) return { ...reused, process: null, owned: false, reused: true, runtimeBundlePath: bundlePath };

  const isInitialized = options.isInitialized ?? openKnowledgeIsInitialized;
  if (!(await isInitialized(bundlePath))) {
    if (options.initializeIfNeeded === false) {
      throw new OpenKnowledgeError(`open-knowledge is not initialized for ${bundlePath}. Run \`ok init\` first.`);
    }
    await runCommand(okCommand, [
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
  const child = spawnProcess(okCommand, args, { stdio: 'ignore' });
  await waitForSpawn(child);

  for (let attempt = 1; attempt <= maxHealthAttempts; attempt += 1) {
    if (child.exitCode != null) {
      throw new OpenKnowledgeError(`open-knowledge exited before becoming ready (code ${child.exitCode})`);
    }
    const status = await getStatus(bundlePath);
    const ready = await readyResult(status, host, fetchImpl);
    if (ready) {
      return { ...ready, process: child, owned: true, reused: false, runtimeBundlePath: bundlePath };
    }
    if (attempt < maxHealthAttempts) await sleep(retryDelayMs);
  }

  child.kill('SIGTERM');
  throw new OpenKnowledgeError(`open-knowledge viewer did not become healthy for ${bundlePath}`);
}

function liveStatus(status: OpenKnowledgeStatus): boolean {
  return status.server.alive && status.ui.alive && Number.isInteger(status.server.port) && Number.isInteger(status.ui.port);
}

async function readyResult(
  status: OpenKnowledgeStatus,
  host: string,
  fetchImpl: typeof fetch,
): Promise<Omit<StartOpenKnowledgeServerResult, 'process' | 'owned' | 'reused' | 'runtimeBundlePath'> | null> {
  if (!liveStatus(status)) return null;
  const apiPort = status.server.port!;
  const port = status.ui.port!;
  const url = `http://${formatUrlHost(host)}:${port}`;
  try {
    const response = await fetchImpl(url, { method: 'GET' });
    if (!response.ok) return null;
  } catch {
    return null;
  }
  return { port, apiPort, url };
}

function normalizeProcessStatus(
  value: OpenKnowledgeProcessStatus | undefined,
  name: string,
): OpenKnowledgeProcessStatus {
  if (!value || typeof value !== 'object') return { name, state: 'missing', alive: false };
  return {
    name,
    state: typeof value.state === 'string' ? value.state : 'missing',
    alive: value.alive === true,
    ...(Number.isInteger(value.pid) ? { pid: value.pid } : {}),
    ...(Number.isInteger(value.port) ? { port: value.port } : {}),
  };
}

function missingStatus(): OpenKnowledgeStatus {
  return {
    server: { name: 'server', state: 'missing', alive: false },
    ui: { name: 'ui', state: 'missing', alive: false },
  };
}

async function findExistingOpenKnowledgeCommand(
  runCommand: CommandRunner,
  shimPath: string,
): Promise<string | null> {
  if (await openKnowledgeBinaryWorks('ok', runCommand)) return 'ok';
  if (await openKnowledgeBinaryWorks(shimPath, runCommand)) return shimPath;
  return null;
}

async function openKnowledgeBinaryWorks(command: string, runCommand: CommandRunner): Promise<boolean> {
  try {
    await runCommand(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function resolveOpenKnowledgeInstallPlan(
  options: OpenKnowledgeSetupOptions & { runCommand: CommandRunner },
): Promise<Exclude<OpenKnowledgeSetupPlan, { kind: 'ready' }>> {
  const resolveRuntime = options.resolveRuntime ?? resolveNode24Runtime;
  const runtime = await resolveRuntime({
    env: options.env,
    homedir: options.homedir,
    listDir: options.listDir,
    realpath: options.realpath,
    runCommand: options.runCommand,
  });

  if (runtime.kind === 'runtime') {
    return {
      kind: 'install-under-runtime',
      source: runtime.source,
      nodePath: runtime.nodePath,
      steps: [
        `Install ${OPEN_KNOWLEDGE_PACKAGE} under the Node 24+ runtime at ${runtime.nodePath}.`,
        'Write an Overdeck-managed shim at ~/.local/bin/ok that pins only the viewer to this runtime. Your default Node and shell configuration will not change.',
      ],
    };
  }

  if (runtime.kind === 'manager-without-24') {
    const installCommand = managerInstallCommand(runtime.manager);
    return {
      kind: 'install-node-via-manager',
      manager: runtime.manager,
      installCommand,
      steps: [managerInstallStep(runtime.manager, installCommand)],
    };
  }

  return {
    kind: 'install-nvm',
    steps: [
      `Install nvm with the official installer while suppressing shell-profile edits: \`${NVM_INSTALL_COMMAND}\`.`,
      'Install Node 24 inside the setup subprocess, then restore the existing nvm default alias exactly—or remove the alias if none existed—before pinning only the OpenKnowledge viewer to that runtime.',
      `For manual setup instead, install Node 24+ yourself, run \`${MANUAL_INSTALL_COMMAND}\`, and retry.`,
    ],
    manualCommand: MANUAL_INSTALL_COMMAND,
  };
}

async function installOpenKnowledgeUnderRuntime(
  nodePath: string,
  options: OpenKnowledgeSetupOptions & { runCommand: CommandRunner },
): Promise<string> {
  const runtimeBin = dirname(nodePath);
  const runtimePrefix = dirname(runtimeBin);
  const env = options.env ?? process.env;
  const pathValue = env.PATH ? `${runtimeBin}${delimiter}${env.PATH}` : runtimeBin;
  await options.runCommand(join(runtimeBin, 'npm'), ['install', '-g', OPEN_KNOWLEDGE_PACKAGE], {
    env: { ...env, PATH: pathValue },
  });

  const resolveRealpath = options.realpath ?? realpath;
  const entryScript = await resolveRealpath(join(runtimePrefix, 'bin', 'ok'));
  const shimPath = resolveShimPath(options);
  return (options.writeShim ?? writeOkShim)({ nodePath, entryScript, shimPath });
}

function resolveShimPath(options: Pick<OpenKnowledgeSetupOptions, 'homedir' | 'shimPath'>): string {
  return options.shimPath ?? join((options.homedir ?? osHomedir)(), '.local', 'bin', 'ok');
}

function managerInstallCommand(manager: NodeVersionManager): string {
  switch (manager) {
    case 'nvm':
      return 'bash -c \'NVM_ROOT="${NVM_DIR:-$HOME/.nvm}"; [ -f "$NVM_ROOT/nvm.sh" ] || NVM_ROOT="$HOME/.config/nvm"; . "$NVM_ROOT/nvm.sh"; DEFAULT_ALIAS_PATH="$NVM_ROOT/alias/default"; DEFAULT_ALIAS_BACKUP="$(mktemp)"; HAD_DEFAULT=0; if [ -f "$DEFAULT_ALIAS_PATH" ]; then HAD_DEFAULT=1; cp "$DEFAULT_ALIAS_PATH" "$DEFAULT_ALIAS_BACKUP"; fi; restore_default() { if [ "$HAD_DEFAULT" -eq 1 ]; then mkdir -p "$(dirname "$DEFAULT_ALIAS_PATH")"; cp "$DEFAULT_ALIAS_BACKUP" "$DEFAULT_ALIAS_PATH"; else rm -f "$DEFAULT_ALIAS_PATH"; fi; rm -f "$DEFAULT_ALIAS_BACKUP"; }; trap restore_default EXIT; nvm install --no-progress 24\'';
    case 'fnm':
      return 'fnm install 24';
    case 'volta':
      return 'volta fetch node@24';
    case 'mise':
      return 'mise install node@24';
    case 'asdf':
      return 'asdf install nodejs latest:24';
  }
}

function managerInstallStep(manager: NodeVersionManager, installCommand: string): string {
  const label = manager === 'nvm' ? 'nvm' : manager === 'fnm' ? 'fnm' : manager[0].toUpperCase() + manager.slice(1);
  const defaultDetail = manager === 'nvm'
    ? 'This shell-local install restores the existing default alias exactly, removes any newly created alias when none existed, and does not change your shell configuration.'
    : `This installs a runtime for OpenKnowledge without changing your default Node or shell configuration.`;
  return `Install Node 24 with ${label} by running \`${installCommand}\`. ${defaultDetail}`;
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

async function runCommandWithSpawn(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
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
