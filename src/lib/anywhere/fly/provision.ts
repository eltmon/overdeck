/**
 * Fly machine provisioning (PAN-4652 WI-7, FR-7).
 *
 * `provisionFlyMachine()` starts a Fly VM that runs `pan serve` and returns
 * once that server answers and has issued a pairing code. Home then links to
 * it over the public route (WI-8). Each remote step runs through the Machines
 * exec API, which has a 60 s deadline, so anything longer (the npm install,
 * dockerd, the server, the watchdog) runs detached with `setsid nohup … &` and
 * is polled.
 *
 * Steps, in order: ensure the app; create the machine with the D-3 proxy
 * service; wait for `started`; make `pan --version` equal home's (D-7); write
 * the `fly-<machineId>` identity (D-6); sync credentials and configure Claude
 * Code; start dockerd when the image has it (D-8); start `pan serve` with the
 * D-4 env and wait for /api/health; install the heartbeat watchdog; read a
 * pairing code from `pan pair --json` (D-1); build the route URL.
 *
 * A failure after the machine exists destroys it before rethrowing: the caller
 * never learns a machine id it could clean up. The Fly API client is used
 * directly for create, exec and destroy (D-11); the Fly provider only syncs
 * credentials, configures Claude Code and writes files. Every dependency is
 * injectable so tests run against a fake API.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FLY_INSTANCE_PARAM } from '../channel/open.js';
import { parseVersionOutput } from '../ssh/target.js';
import { loadConfig, type RemoteConfig } from '../../config.js';
import { packageRoot } from '../../paths.js';
import { createFlyApiClient, FlyApiError, type FlyApiClient, type FlyExecResult } from '../../remote/fly-api.js';
import type { FlyProvider } from '../../remote/fly-provider.js';
import { createFlyProviderFromConfig } from '../../remote/index.js';
import { generateEphemeralWatchdogScript, REMOTE_HOST_HEARTBEAT_PATH, writeRemoteFile } from '../../remote/remote-agents.js';
import { REMOTE_PAN_DIR, shellQuote } from '../../remote/remote-tmux.js';

export type FlyMachineErrorCode =
  | 'bad-request'
  | 'remote-disabled'
  | 'no-fly-token'
  | 'cap-reached'
  | 'harness-unsupported'
  | 'version-mismatch'
  | 'server-not-ready'
  | 'pairing-failed'
  | 'unreachable'
  | 'project-failed'
  | 'conversation-failed';

/** HTTP status of each Fly machine error. */
export const FLY_MACHINE_ERROR_STATUS: Record<FlyMachineErrorCode, number> = {
  'bad-request': 400,
  'remote-disabled': 409,
  'no-fly-token': 424,
  'cap-reached': 429,
  'harness-unsupported': 400,
  'version-mismatch': 409,
  'server-not-ready': 502,
  'pairing-failed': 502,
  'unreachable': 502,
  'project-failed': 502,
  'conversation-failed': 502,
};

export class FlyMachineError extends Error {
  constructor(
    readonly code: FlyMachineErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'FlyMachineError';
  }
}

/** Port `pan serve` listens on inside the VM; the Fly proxy forwards 443 to it (D-3). */
const FLY_MACHINE_SERVE_PORT = 3011;
const SERVE_LOG = '/root/.overdeck/fly-serve.log';
const IDENTITY_PATH = '/root/.overdeck/environment-id.json';
const WATCHDOG_SCRIPT = `${REMOTE_PAN_DIR}/fly-machine-watchdog.js`;
const WATCHDOG_LOG = `${REMOTE_PAN_DIR}/fly-machine-watchdog.log`;
const EXEC_TIMEOUT_SECONDS = 60;
const MIN_MEMORY_MB = 2048;
const PAIRING_CODE_RE = /^odp_[0-9a-f]{64}$/;

// The same defaults as FlyProvider's constructor.
const DEFAULT_APP = 'pan-workspaces';
const DEFAULT_ORG = 'personal';
const DEFAULT_REGION = 'iad';
const DEFAULT_SIZE = 'shared-cpu-2x';
const DEFAULT_IMAGE = 'registry.fly.io/pan-workspace:latest';

const INSTALL_POLL = { intervalMs: 5_000, limitMs: 5 * 60_000 };
const DOCKER_POLL = { intervalMs: 2_000, limitMs: 60_000 };
const HEALTH_POLL = { intervalMs: 2_000, limitMs: 120_000 };

export type FlyMachineApi = Pick<FlyApiClient, 'ensureApp' | 'createMachine' | 'waitForState' | 'execCommand' | 'destroyMachine'>;

export interface FlyProvisionDeps {
  api: FlyMachineApi;
  flyConfig: NonNullable<RemoteConfig['fly']>;
  syncAllCredentials: (machineName: string) => Promise<unknown>;
  configureClaudeCode: (machineName: string) => Promise<void>;
  writeRemoteFile: (machineName: string, path: string, content: string) => Promise<void>;
  localVersion: () => Promise<string>;
  /** Milliseconds since the epoch. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  newId: () => string;
  /** The 8 hex characters of `overdeck-machine-<hex>`. */
  machineSuffix: () => string;
  log: (message: string) => void;
}

export interface FlyProvisionResult {
  machineId: string;
  machineName: string;
  appName: string;
  region: string;
  label: string;
  environmentId: string;
  docker: boolean;
  pairingCode: string;
  routeUrl: `wss://${string}`;
}

async function readHomeVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof manifest.version !== 'string' || !manifest.version) throw new Error('package.json has no version');
  return manifest.version;
}

/** Fill in every dependency the caller did not pass, loading config only when needed. */
async function resolveDeps(overrides: Partial<FlyProvisionDeps>): Promise<FlyProvisionDeps> {
  const needsConfig = !overrides.api || !overrides.flyConfig || !overrides.syncAllCredentials
    || !overrides.configureClaudeCode || !overrides.writeRemoteFile;
  const remote = needsConfig ? (await loadConfig()).remote : undefined;
  let provider: FlyProvider | null = null;
  const fly = (): FlyProvider => (provider ??= createFlyProviderFromConfig(remote, 'ephemeral'));
  return {
    api: overrides.api ?? createFlyApiClient(process.env[remote?.fly?.api_token_env ?? 'FLY_API_TOKEN']),
    flyConfig: overrides.flyConfig ?? remote?.fly ?? {},
    syncAllCredentials: overrides.syncAllCredentials ?? ((name) => fly().syncAllCredentials(name)),
    configureClaudeCode: overrides.configureClaudeCode ?? ((name) => fly().configureClaudeCode(name)),
    writeRemoteFile: overrides.writeRemoteFile ?? ((name, path, content) => writeRemoteFile(fly(), name, path, content)),
    localVersion: overrides.localVersion ?? readHomeVersion,
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    newId: overrides.newId ?? randomUUID,
    machineSuffix: overrides.machineSuffix ?? (() => randomBytes(4).toString('hex')),
    log: overrides.log ?? ((message) => console.warn(`[fly-machines] ${message}`)),
  };
}

/** Probe every `intervalMs` until it returns true or `limitMs` passes. A throwing probe counts as false. */
async function pollUntil(deps: FlyProvisionDeps, poll: { intervalMs: number; limitMs: number }, probe: () => Promise<boolean>): Promise<boolean> {
  const deadline = deps.now() + poll.limitMs;
  for (;;) {
    if (await probe().catch(() => false)) return true;
    if (deps.now() + poll.intervalMs > deadline) return false;
    await deps.sleep(poll.intervalMs);
  }
}

/** Run `script` detached on the VM so it outlives the 60 s exec deadline. */
function detached(script: string): string {
  return `setsid nohup sh -c ${shellQuote(script)} > /dev/null 2>&1 < /dev/null &`;
}

/** Destroy a Fly machine. A 404 means it is already gone. */
export async function destroyFlyVm(appName: string, machineId: string, deps: Partial<Pick<FlyProvisionDeps, 'api'>> = {}): Promise<void> {
  const api = deps.api ?? (await resolveDeps({})).api;
  try {
    await api.destroyMachine(appName, machineId);
  } catch (error) {
    if (error instanceof FlyApiError && error.statusCode === 404) return;
    throw error;
  }
}

export async function provisionFlyMachine(
  input: { region?: string; image?: string },
  overrides: Partial<FlyProvisionDeps> = {},
): Promise<FlyProvisionResult> {
  const deps = await resolveDeps(overrides);
  const cfg = deps.flyConfig;
  const appName = cfg.app ?? DEFAULT_APP;

  // 1. App and a name unique within it (D-11: the provider resolves names).
  await deps.api.ensureApp(appName, cfg.org ?? DEFAULT_ORG);
  const machineName = `overdeck-machine-${deps.machineSuffix()}`;

  // 2. Create with the D-3 proxy service and the D-12 memory floor.
  const machine = await deps.api.createMachine(appName, machineName, {
    image: input.image ?? cfg.image ?? DEFAULT_IMAGE,
    size: cfg.vm_size ?? DEFAULT_SIZE,
    memory: Math.max(cfg.vm_memory ?? 1024, MIN_MEMORY_MB),
    region: input.region ?? cfg.region ?? DEFAULT_REGION,
    restart: { policy: 'no' },
    auto_destroy: false,
    metadata: { overdeck: 'machine' },
    services: [{ protocol: 'tcp', internal_port: FLY_MACHINE_SERVE_PORT, ports: [{ port: 443, handlers: ['tls', 'http'] }] }],
  });
  const machineId = machine.id;
  const region = machine.region || input.region || cfg.region || DEFAULT_REGION;

  try {
    return await prepareMachine(deps, { appName, machineId, machineName, region });
  } catch (error) {
    await destroyFlyVm(appName, machineId, deps).catch((destroyError: unknown) => {
      deps.log(`Could not destroy ${machineId} after a failed provision: ${(destroyError as Error).message}`);
    });
    throw error;
  }
}

async function prepareMachine(
  deps: FlyProvisionDeps,
  vm: { appName: string; machineId: string; machineName: string; region: string },
): Promise<FlyProvisionResult> {
  const { appName, machineId, machineName } = vm;
  const exec = (command: string): Promise<FlyExecResult> =>
    deps.api.execCommand(appName, machineId, ['/bin/sh', '-c', command], EXEC_TIMEOUT_SECONDS);
  const run = async (command: string, step: string): Promise<string> => {
    const result = await exec(command);
    if (result.exit_code !== 0) {
      throw new Error(`${step} failed on Fly machine ${machineId} (exit ${result.exit_code}): ${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout;
  };
  const succeeds = async (command: string): Promise<boolean> => (await exec(command)).exit_code === 0;

  // 3. Started.
  await deps.api.waitForState(appName, machineId, 'started', 300);

  // 4. Version equality by install (D-7).
  const want = await deps.localVersion();
  const vmVersion = async (): Promise<string | null> => {
    const result = await exec('pan --version');
    return result.exit_code === 0 ? parseVersionOutput(result.stdout) : null;
  };
  let have = await vmVersion();
  if (have !== want) {
    await run(`rm -f /tmp/pan-install.exit && ${detached(`npm install -g ${shellQuote(`@overdeck/core@${want}`)} > /tmp/pan-install.log 2>&1; echo $? > /tmp/pan-install.exit`)}`, 'Starting the pan install');
    await pollUntil(deps, INSTALL_POLL, async () => (await exec('cat /tmp/pan-install.exit')).stdout.trim() !== '');
    have = await vmVersion();
    if (have !== want) {
      throw new FlyMachineError('version-mismatch', `The Fly machine runs pan ${have ?? '(none)'}, but this machine runs ${want}; npm install -g @overdeck/core@${want} did not fix it (see /tmp/pan-install.log on the VM).`, { home: want, vm: have });
    }
  }

  // 5. Identity before the server first starts (D-6).
  const environmentId = deps.newId();
  const label = `fly-${machineId}`;
  const identity = { v: 1, environmentId, label, createdAt: new Date(deps.now()).toISOString() };
  await run('mkdir -p /root/.overdeck', 'Creating /root/.overdeck');
  await deps.writeRemoteFile(machineName, IDENTITY_PATH, `${JSON.stringify(identity, null, 2)}\n`);
  await run(`chmod 600 ${IDENTITY_PATH}`, 'Protecting the identity file');

  // 6. Credentials and Claude Code settings.
  await deps.syncAllCredentials(machineName);
  await deps.configureClaudeCode(machineName);

  // 7. Docker when the image has it (D-8). A failure is logged, never fatal.
  let docker = false;
  if (await succeeds('command -v dockerd')) {
    await run(`${detached('dockerd > /var/log/dockerd.log 2>&1')}`, 'Starting dockerd');
    docker = await pollUntil(deps, DOCKER_POLL, () => succeeds('docker info > /dev/null 2>&1'));
    if (!docker) deps.log(`dockerd did not answer docker info within 60 s on ${machineId}; continuing without Docker`);
  }

  // 8. The server, with the D-4 env, then its health.
  const env = `OVERDECK_TERMINAL_BACKEND=tmux IS_SANDBOX=1 OVERDECK_PUBLIC_LINK_ONLY=1 PORT=${FLY_MACHINE_SERVE_PORT}`;
  await run(`setsid nohup env ${env} pan serve --port ${FLY_MACHINE_SERVE_PORT} --no-open > ${SERVE_LOG} 2>&1 < /dev/null &`, 'Starting pan serve');
  const healthy = await pollUntil(deps, HEALTH_POLL, () => succeeds(`curl -fsS http://127.0.0.1:${FLY_MACHINE_SERVE_PORT}/api/health`));
  if (!healthy) {
    const tail = await exec(`tail -n 40 ${SERVE_LOG}`).then((result) => result.stdout, () => '');
    throw new FlyMachineError('server-not-ready', `pan serve on Fly machine ${machineId} did not answer /api/health within 120 s. Last lines of ${SERVE_LOG}:\n${tail}`, { log: tail });
  }

  // 9. Watchdog: the VM stops itself 300 s after home stops heartbeating (PAN-4295).
  await deps.writeRemoteFile(machineName, WATCHDOG_SCRIPT, generateEphemeralWatchdogScript({ heartbeatPath: REMOTE_HOST_HEARTBEAT_PATH, logFile: WATCHDOG_LOG }));
  await run(`date -u +%FT%TZ > ${REMOTE_HOST_HEARTBEAT_PATH}`, 'Writing the first heartbeat');
  await run(detached(`node ${WATCHDOG_SCRIPT}`), 'Starting the watchdog');

  // 10. Pairing code, issued by the VM's own server (D-1).
  const pairingCode = parsePairingCredential(await exec('pan pair --json'));
  if (pairingCode === null) {
    throw new FlyMachineError('pairing-failed', `pan pair --json on Fly machine ${machineId} did not print a pairing credential.`);
  }

  // 11. Route.
  const routeUrl = `wss://${appName}.fly.dev/ws/link?${FLY_INSTANCE_PARAM}=${machineId}` as const;
  return { machineId, machineName, appName, region: vm.region, label, environmentId, docker, pairingCode, routeUrl };
}

/** The `credential` of the last JSON line `pan pair --json` printed, or null. */
function parsePairingCredential(result: FlyExecResult): string | null {
  if (result.exit_code !== 0) return null;
  for (const line of result.stdout.split(/\r?\n/).reverse()) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const credential = (JSON.parse(line) as { credential?: unknown }).credential;
      return typeof credential === 'string' && PAIRING_CODE_RE.test(credential) ? credential : null;
    } catch {
      return null;
    }
  }
  return null;
}
