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
 * Code; prepare Codex (PAN-4296 step 6b: pin `codex --version` to home's and
 * push home's Codex sign-in); start dockerd when the image has it (D-8); start
 * `pan serve` with the D-4 env and wait for /api/health; install the heartbeat
 * watchdog; read a pairing code from `pan pair --json` (D-1); build the route URL.
 *
 * Credentials are required per harness (PAN-4296 FR-5): Claude Code credentials
 * only for a `claude-code` machine, a usable Codex sign-in only for a `codex`
 * one. Codex is prepared whenever home can, so a Claude-first machine can take
 * a Codex conversation later; for `claude-code` a Codex miss is only logged.
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
import { DEFAULT_FLY_APP, defaultFlyImage, type FlyProvider } from '../../remote/fly-provider.js';
import { createFlyProviderFromConfig } from '../../remote/index.js';
import { generateEphemeralWatchdogScript, REMOTE_HOST_HEARTBEAT_PATH, writeRemoteFile } from '../../remote/remote-agents.js';
import { REMOTE_PAN_DIR, shellQuote } from '../../remote/remote-tmux.js';
import { type HomeCodexState, prepareFlyCodex, readHomeCodexState } from './codex-auth.js';
import { detached, FlyMachineError, INSTALL_POLL, pollUntil } from './provision-shared.js';

export { detached, FLY_MACHINE_ERROR_STATUS, FlyMachineError, type FlyMachineErrorCode, pollUntil } from './provision-shared.js';

/** The harness a Fly machine is started for (PAN-4296). */
export type FlyMachineHarness = 'claude-code' | 'codex';

/** Port `pan serve` listens on inside the VM; the Fly proxy forwards 443 to it (D-3). */
const FLY_MACHINE_SERVE_PORT = 3011;
/**
 * The Overdeck home of every process started through the Machines exec API,
 * `pan serve` included. Fly's exec shell runs with `HOME=/`, not `/root`, so
 * the home is read from that shell rather than assumed (PAN-4652 live run).
 */
const OVERDECK_HOME_PROBE = 'printf %s "${OVERDECK_HOME:-$HOME/.overdeck}"';
const WATCHDOG_SCRIPT = `${REMOTE_PAN_DIR}/fly-machine-watchdog.js`;
const WATCHDOG_LOG = `${REMOTE_PAN_DIR}/fly-machine-watchdog.log`;
const EXEC_TIMEOUT_SECONDS = 60;
const MIN_MEMORY_MB = 2048;
const PAIRING_CODE_RE = /^odp_[0-9a-f]{64}$/;

// The same defaults as FlyProvider's constructor.
const DEFAULT_APP = DEFAULT_FLY_APP;
const DEFAULT_ORG = 'personal';
const DEFAULT_REGION = 'iad';
const DEFAULT_SIZE = 'shared-cpu-2x';

const DOCKER_POLL = { intervalMs: 2_000, limitMs: 60_000 };
const HEALTH_POLL = { intervalMs: 2_000, limitMs: 120_000 };

export type FlyMachineApi = Pick<FlyApiClient, 'ensureApp' | 'createMachine' | 'waitForState' | 'execCommand' | 'destroyMachine'>;

export interface FlyProvisionDeps {
  api: FlyMachineApi;
  flyConfig: NonNullable<RemoteConfig['fly']>;
  syncAllCredentials: (machineName: string) => Promise<{ claude: boolean; github: boolean }>;
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
  /** Home's Codex binary, version and valid sign-in, or null (PAN-4296 D-2). */
  homeCodex: () => Promise<HomeCodexState | null>;
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
  /** `$HOME/.codex/auth.json` on the VM when Codex was prepared; null otherwise. */
  codexAuthPath: string | null;
}

async function readHomeVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof manifest.version !== 'string' || !manifest.version) throw new Error('package.json has no version');
  return manifest.version;
}

function flyApiFor(remote: RemoteConfig | undefined): FlyApiClient {
  return createFlyApiClient(process.env[remote?.fly?.api_token_env ?? 'FLY_API_TOKEN']);
}

/** The Fly API client for the configured token (`remote.fly.api_token_env`, else FLY_API_TOKEN, else flyctl's). */
export async function loadFlyApi(): Promise<FlyApiClient> {
  return flyApiFor((await loadConfig()).remote);
}

/** Fill in every dependency the caller did not pass, loading config only when needed. */
async function resolveDeps(overrides: Partial<FlyProvisionDeps>): Promise<FlyProvisionDeps> {
  const needsConfig = !overrides.api || !overrides.flyConfig || !overrides.syncAllCredentials
    || !overrides.configureClaudeCode || !overrides.writeRemoteFile;
  const remote = needsConfig ? (await loadConfig()).remote : undefined;
  let provider: FlyProvider | null = null;
  const fly = (): FlyProvider => (provider ??= createFlyProviderFromConfig(remote, 'ephemeral'));
  return {
    api: overrides.api ?? flyApiFor(remote),
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
    homeCodex: overrides.homeCodex ?? (() => readHomeCodexState()),
  };
}

/** Destroy a Fly machine. A 404 means it is already gone. */
export async function destroyFlyVm(appName: string, machineId: string, deps: { api?: Pick<FlyApiClient, 'destroyMachine'> } = {}): Promise<void> {
  const api = deps.api ?? await loadFlyApi();
  try {
    await api.destroyMachine(appName, machineId);
  } catch (error) {
    if (error instanceof FlyApiError && error.statusCode === 404) return;
    throw error;
  }
}

/** The machine as soon as it exists, before it is prepared. */
export interface FlyCreatedMachine {
  machineId: string;
  machineName: string;
  appName: string;
  region: string;
}

export async function provisionFlyMachine(
  input: { region?: string; image?: string; harness?: FlyMachineHarness },
  overrides: Partial<FlyProvisionDeps> = {},
  hooks: {
    /** Called once the machine exists, so the caller can record it before any later step can fail. */
    onCreated?: (machine: FlyCreatedMachine) => Promise<void>;
  } = {},
): Promise<FlyProvisionResult> {
  const deps = await resolveDeps(overrides);
  const cfg = deps.flyConfig;
  const appName = cfg.app ?? DEFAULT_APP;

  // 1. App and a name unique within it (D-11: the provider resolves names).
  await deps.api.ensureApp(appName, cfg.org ?? DEFAULT_ORG);
  const machineName = `overdeck-machine-${deps.machineSuffix()}`;

  // 2. Create with the D-3 proxy service and the D-12 memory floor.
  const machine = await deps.api.createMachine(appName, machineName, {
    image: input.image ?? cfg.image ?? defaultFlyImage(appName),
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
    await hooks.onCreated?.({ machineId, machineName, appName, region });
    return await prepareMachine(deps, { appName, machineId, machineName, region }, input.harness ?? 'claude-code');
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
  harness: FlyMachineHarness,
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

  // 5. Identity before the server first starts (D-6), in the home that server will use.
  const overdeckHome = (await run(OVERDECK_HOME_PROBE, 'Reading the Overdeck home')).trim().replace(/\/+/g, '/');
  if (!overdeckHome.startsWith('/')) throw new Error(`Fly machine ${machineId} reported no absolute Overdeck home (got "${overdeckHome}")`);
  const identityPath = `${overdeckHome}/environment-id.json`;
  const serveLog = `${overdeckHome}/fly-serve.log`;
  const environmentId = deps.newId();
  const label = `fly-${machineId}`;
  const identity = { v: 1, environmentId, label, createdAt: new Date(deps.now()).toISOString() };
  await run(`mkdir -p ${shellQuote(overdeckHome)}`, `Creating ${overdeckHome}`);
  await deps.writeRemoteFile(machineName, identityPath, `${JSON.stringify(identity, null, 2)}\n`);
  await run(`chmod 600 ${shellQuote(identityPath)}`, 'Protecting the identity file');

  // 6. Credentials and Claude Code settings. Without Claude credentials a Claude Code
  // machine cannot run its conversation, so that fails here; a Codex machine only logs
  // it (FR-5). A missing GitHub token fails only a later clone.
  const synced = await deps.syncAllCredentials(machineName);
  if (!synced.claude) {
    if (harness === 'claude-code') {
      throw new FlyMachineError('credentials-failed', `Could not copy Claude Code credentials to Fly machine ${machineId}: this machine has no ~/.claude/.credentials.json, or the copy failed. Log in to Claude Code here, then try again.`);
    }
    deps.log(`Could not copy Claude Code credentials to Fly machine ${machineId}; Claude Code conversations there will fail`);
  }
  if (!synced.github) deps.log(`Could not copy GitHub auth to Fly machine ${machineId}; cloning a private repository there will fail`);
  await deps.configureClaudeCode(machineName);

  // 6b. Codex (PAN-4296 D-2, D-4, D-6): fatal only for a Codex machine.
  const codexAuthPath = await prepareFlyCodex(
    (command, timeoutSeconds) => deps.api.execCommand(appName, machineId, ['/bin/sh', '-c', command], timeoutSeconds),
    deps,
    { harness, machineId },
  );

  // 7. Docker when the image has it (D-8). A failure is logged, never fatal.
  let docker = false;
  if (await succeeds('command -v dockerd')) {
    // The VM's root filesystem cannot host overlay mounts ("invalid argument"), so
    // Docker uses the vfs driver: slower and larger on disk, but it runs (PAN-4652 O3).
    await run(`${detached('dockerd --storage-driver=vfs > /var/log/dockerd.log 2>&1')}`, 'Starting dockerd');
    docker = await pollUntil(deps, DOCKER_POLL, () => succeeds('docker info > /dev/null 2>&1'));
    if (!docker) deps.log(`dockerd did not answer docker info within 60 s on ${machineId}; continuing without Docker`);
  }

  // 8. The server, with the D-4 env, then its health.
  const env = `OVERDECK_TERMINAL_BACKEND=tmux IS_SANDBOX=1 OVERDECK_PUBLIC_LINK_ONLY=1 PORT=${FLY_MACHINE_SERVE_PORT}`;
  await run(`setsid nohup env ${env} pan serve --port ${FLY_MACHINE_SERVE_PORT} --no-open > ${shellQuote(serveLog)} 2>&1 < /dev/null &`, 'Starting pan serve');
  const healthy = await pollUntil(deps, HEALTH_POLL, () => succeeds(`curl -fsS http://127.0.0.1:${FLY_MACHINE_SERVE_PORT}/api/health`));
  if (!healthy) {
    const tail = await exec(`tail -n 40 ${shellQuote(serveLog)}`).then((result) => result.stdout, () => '');
    throw new FlyMachineError('server-not-ready', `pan serve on Fly machine ${machineId} did not answer /api/health within 120 s. Last lines of ${serveLog}:\n${tail}`, { log: tail });
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
  return { machineId, machineName, appName, region: vm.region, label, environmentId, docker, pairingCode, routeUrl, codexAuthPath };
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
