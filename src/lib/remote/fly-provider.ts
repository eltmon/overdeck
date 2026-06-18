/**
 * Fly.io Remote Provider
 *
 * Implements the RemoteProvider interface using Fly Machines API and Fly CLI.
 * VM lifecycle is managed via REST API; exec/SSH via Fly CLI.
 *
 * PAN-1249: Effect migration. All RemoteProvider methods now return
 * `Effect.Effect<T, RemoteError>` to participate in typed error channels.
 * Internal helpers retain their async/Promise shape because they sit below
 * the Effect boundary and are converted at the public surface.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse } from 'yaml';
import { Effect, Stream } from 'effect';
import { getIsolatedPlaywrightMcpConfigSync } from '../claude-mcp.js';
import { buildClaudeUserSettingsSync } from '../claude-permissions.js';
import { FlyApiClient, createFlyApiClientSync, FlyApiError } from './fly-api.js';
import type { RemoteProvider, VmInfo, VmStatus, ExecResult } from './interface.js';
import { RemoteError } from './interface.js';

const execAsync = promisify(exec);

export interface FlyProviderConfig {
  /** Fly.io app name for workspace machines (default: pan-workspaces) */
  app?: string;
  /** Fly.io org slug */
  org?: string;
  /** Default region (default: iad) */
  region?: string;
  /** Machine size (default: shared-cpu-2x) */
  vmSize?: string;
  /** Memory in MB (default: 1024) */
  vmMemory?: number;
  /** Docker image for workspace machines */
  image?: string;
  /** API token (falls back to FLY_API_TOKEN env var) */
  apiToken?: string;
  /** Durability/resiliency tier (default: ephemeral) */
  resiliencyTier?: 'ephemeral' | 'durable';
}

const DURABLE_VOLUME_SIZE_GB = 10;
const DURABLE_MAX_RETRIES = 3;

function mapFlyStateToVmStatus(state: string): VmStatus {
  switch (state) {
    case 'started':
      return 'running';
    case 'stopped':
    case 'suspended':
      return 'stopped';
    case 'created':
    case 'replacing':
      return 'creating';
    case 'destroying':
    case 'destroyed':
      return 'deleting';
    default:
      return 'unknown';
  }
}

/** Wrap a Promise-returning function as an Effect with a tagged RemoteError. */
function effFromPromise<T>(
  operation: string,
  thunk: () => Promise<T>,
): Effect.Effect<T, RemoteError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (cause) =>
      new RemoteError({
        operation,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
}

export class FlyProvider implements RemoteProvider {
  readonly name = 'fly';

  private readonly config: Required<FlyProviderConfig>;
  private api: FlyApiClient | null = null;

  constructor(config: FlyProviderConfig = {}) {
    this.config = {
      app: config.app ?? 'pan-workspaces',
      org: config.org ?? 'personal',
      region: config.region ?? 'iad',
      vmSize: config.vmSize ?? 'shared-cpu-2x',
      vmMemory: config.vmMemory ?? 1024,
      image: config.image ?? 'registry.fly.io/pan-workspace:latest',
      apiToken: config.apiToken ?? process.env.FLY_API_TOKEN ?? '',
      resiliencyTier: config.resiliencyTier ?? 'ephemeral',
    };
  }

  getResiliencyTier(): 'ephemeral' | 'durable' {
    return this.config.resiliencyTier;
  }

  private getApi(): FlyApiClient {
    if (!this.api) {
      this.api = createFlyApiClientSync(this.config.apiToken || undefined);
    }
    return this.api;
  }

  isAuthenticated(): Effect.Effect<boolean, RemoteError> {
    return effFromPromise('isAuthenticated', async () => {
      // Check API token first
      if (this.config.apiToken || process.env.FLY_API_TOKEN) {
        try {
          await this.getApi().listMachines(this.config.app);
          return true;
        } catch {
          // Fall through to CLI check
        }
      }

      // Check fly CLI auth
      try {
        const result = await execAsync('fly auth whoami', { timeout: 10000 });
        return !result.stdout.includes('not logged in');
      } catch {
        return false;
      }
    });
  }

  /**
   * Resolve vmName to {appName, machineId} by scanning workspace metadata.
   * Falls back to listing machines in the app.
   *
   * Internal helper: returns a Promise because all of its callers compose it
   * inside other Effect-wrapped operations.
   */
  async resolveVm(vmName: string): Promise<{ appName: string; machineId: string }> {
    const workspacesDir = join(homedir(), '.overdeck', 'workspaces');
    if (existsSync(workspacesDir)) {
      for (const file of readdirSync(workspacesDir)) {
        if (!file.endsWith('.yaml')) continue;
        try {
          const content = readFileSync(join(workspacesDir, file), 'utf-8');
          const metadata = parse(content) as { vmName?: string; machineId?: string; appName?: string };
          if (metadata.vmName === vmName && metadata.machineId && metadata.appName) {
            return { appName: metadata.appName, machineId: metadata.machineId };
          }
        } catch {
          // Skip invalid files
        }
      }
    }

    // Fallback: search by machine name via API
    const machines = await this.getApi().listMachines(this.config.app);
    const machine = machines.find(m => m.name === vmName);
    if (!machine) {
      throw new Error(`No Fly machine found for VM name: ${vmName}`);
    }
    return { appName: this.config.app, machineId: machine.id };
  }

  createVm(name: string): Effect.Effect<VmInfo, RemoteError> {
    return effFromPromise('createVm', async () => {
      const api = this.getApi();

      // Ensure app exists
      await api.ensureApp(this.config.app, this.config.org);

      // Get-or-create: machine names are unique per app, so a leftover
      // machine from a crashed/interrupted run makes a plain create 422.
      // Adopt it instead — rootfs resets from the image on start, so a
      // restarted leftover is indistinguishable from a fresh machine for
      // the provisioning steps that follow.
      const existing = (await api.listMachines(this.config.app)).find(
        (m) => m.name === name && m.state !== 'destroyed',
      );
      const isDurable = this.config.resiliencyTier === 'durable';
      const expectedVolumeName = `${name}-workspace`;
      let volumeId: string | undefined;

      if (isDurable) {
        const volumes = await api.listVolumes(this.config.app);

        if (existing) {
          // Adopted machine: require a volume already attached to it. Do not
          // create a new volume here — doing so would orphan it when we throw.
          const attached = volumes.find(
            (v) =>
              v.name === expectedVolumeName &&
              v.region === this.config.region &&
              v.state !== 'destroyed' &&
              v.attached_machine_id === existing.id,
          );
          if (!attached) {
            throw new Error(
              `Durable tier requires a /workspace volume for '${name}', but the existing machine ` +
                `'${existing.id}' does not have volume '${expectedVolumeName}' attached. ` +
                `Destroy the existing machine or choose a different name.`,
            );
          }
          volumeId = attached.id;
        } else {
          // Fresh machine: reuse an unattached volume in this region, or create one.
          const available = volumes.find(
            (v) =>
              v.name === expectedVolumeName &&
              v.region === this.config.region &&
              v.state !== 'destroyed' &&
              !v.attached_machine_id,
          );
          volumeId = available?.id ??
            (await api.createVolume(this.config.app, {
              name: expectedVolumeName,
              region: this.config.region,
              sizeGb: DURABLE_VOLUME_SIZE_GB,
            })).id;
        }
      }

      if (existing) {
        if (existing.state !== 'started') {
          await api.startMachine(this.config.app, existing.id);
        }
        await api.waitForState(this.config.app, existing.id, 'started', 300);
        const fresh = await api.getMachine(this.config.app, existing.id);
        return {
          name,
          status: mapFlyStateToVmStatus(fresh.state),
          machineId: fresh.id,
          ipAddress: fresh.private_ip,
          created: fresh.created_at ? new Date(fresh.created_at) : undefined,
        };
      }

      // Create machine
      const machine = await api.createMachine(this.config.app, name, {
        image: this.config.image,
        size: this.config.vmSize,
        memory: this.config.vmMemory,
        region: this.config.region,
        restart: isDurable
          ? { policy: 'on-failure', max_retries: DURABLE_MAX_RETRIES }
          : { policy: 'no' },
        auto_destroy: false,
        ...(volumeId ? { mounts: [{ volume: volumeId, path: '/workspace' }] } : {}),
      });

      // Wait for machine to start. This must be fatal: callers exec commands
      // immediately after createVm, and a not-yet-started machine 412s every
      // exec. First boot pulls the full image from the registry, which can
      // exceed two minutes — hence the generous timeout.
      try {
        await api.waitForState(this.config.app, machine.id, 'started', 300);
      } catch (cause) {
        throw new Error(
          `Machine ${machine.id} (${name}) did not reach 'started' within 300s — ` +
            `likely still pulling the image. Check: fly machines list -a ${this.config.app}`,
          { cause }
        );
      }

      return {
        name,
        status: mapFlyStateToVmStatus(machine.state),
        machineId: machine.id,
        ipAddress: machine.private_ip,
        created: machine.created_at ? new Date(machine.created_at) : undefined,
      };
    });
  }

  deleteVm(name: string): Effect.Effect<void, RemoteError> {
    return effFromPromise('deleteVm', async () => {
      const { appName, machineId } = await this.resolveVm(name);
      const api = this.getApi();
      await api.destroyMachine(appName, machineId);

      // Best-effort teardown of the associated durable-tier volume. An
      // ephemeral machine has no such volume, so this is a no-op there.
      const expectedVolumeName = `${name}-workspace`;
      try {
        const volumes = await api.listVolumes(appName);
        const volume = volumes.find(
          (v) =>
            v.name === expectedVolumeName &&
            v.state !== 'destroyed' &&
            (v.attached_machine_id === machineId ||
              v.attached_machine_id === null ||
              v.attached_machine_id === undefined),
        );
        if (volume) {
          await api.deleteVolume(appName, volume.id);
        }
      } catch {
        // Don't fail teardown because the volume delete didn't succeed;
        // the machine is already gone and the caller has what it needs.
      }
    });
  }

  listVms(): Effect.Effect<VmInfo[], RemoteError> {
    return effFromPromise('listVms', async () => {
      const machines = await this.getApi().listMachines(this.config.app);
      return machines.map(m => ({
        name: m.name,
        status: mapFlyStateToVmStatus(m.state),
        machineId: m.id,
        ipAddress: m.private_ip,
        created: m.created_at ? new Date(m.created_at) : undefined,
      }));
    });
  }

  getStatus(name: string): Effect.Effect<VmStatus, RemoteError> {
    return effFromPromise('getStatus', async () => {
      try {
        const { appName, machineId } = await this.resolveVm(name);
        const machine = await this.getApi().getMachine(appName, machineId);
        return mapFlyStateToVmStatus(machine.state);
      } catch {
        return 'unknown' as VmStatus;
      }
    });
  }

  getVmInfo(name: string): Effect.Effect<VmInfo | null, RemoteError> {
    return effFromPromise('getVmInfo', async () => {
      try {
        const { appName, machineId } = await this.resolveVm(name);
        const machine = await this.getApi().getMachine(appName, machineId);
        return {
          name,
          status: mapFlyStateToVmStatus(machine.state),
          machineId: machine.id,
          ipAddress: machine.private_ip,
          created: machine.created_at ? new Date(machine.created_at) : undefined,
          memoryTotal: machine.config?.guest?.memory_mb,
        };
      } catch {
        return null;
      }
    });
  }

  startVm(name: string): Effect.Effect<void, RemoteError> {
    return effFromPromise('startVm', async () => {
      const { appName, machineId } = await this.resolveVm(name);
      await this.getApi().startMachine(appName, machineId);
      await this.getApi().waitForState(appName, machineId, 'started', 60);
    });
  }

  stopVm(name: string): Effect.Effect<void, RemoteError> {
    return effFromPromise('stopVm', async () => {
      const { appName, machineId } = await this.resolveVm(name);
      await this.getApi().stopMachine(appName, machineId);
    });
  }

  /** Execute a command on the VM via Fly Machines exec API */
  ssh(vm: string, command: string): Effect.Effect<ExecResult, RemoteError> {
    return effFromPromise('ssh', () => this.sshImpl(vm, command));
  }

  private async sshImpl(vm: string, command: string): Promise<ExecResult> {
    const { appName, machineId } = await this.resolveVm(vm);
    // The Machines exec API rate-limits per-machine actions; bursts of execs
    // (e.g. chunked file writes) hit 429 resource_exhausted. Back off and
    // retry before surfacing the error.
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.getApi().execCommand(
          appName,
          machineId,
          ['/bin/sh', '-c', command],
          60
        );
        return {
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          exitCode: result.exit_code ?? 0,
        };
      } catch (err) {
        if (err instanceof FlyApiError) {
          if (err.statusCode === 429 && attempt < 4) {
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            continue;
          }
          return { stdout: '', stderr: err.message, exitCode: 1 };
        }
        throw err;
      }
    }
  }

  /** Stream command output via fly SSH console */
  sshStream(vm: string, command: string): Stream.Stream<string, RemoteError> {
    const self = this;
    async function* iter(): AsyncIterable<string> {
      const { appName } = await self.resolveVm(vm);
      const child = spawn('fly', ['ssh', 'console', '-a', appName, '-C', command], {
        env: { ...process.env },
      });
      for await (const chunk of child.stdout) {
        yield chunk.toString();
      }
      for await (const chunk of child.stderr) {
        yield chunk.toString();
      }
      await new Promise<void>((resolve, reject) => {
        child.on('close', () => resolve());
        child.on('error', reject);
      });
    }
    return Stream.fromAsyncIterable(iter(), (cause) =>
      new RemoteError({
        operation: 'sshStream',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
    );
  }

  /** Copy a local file to VM using base64 encoding */
  copyToVm(vm: string, localPath: string, remotePath: string): Effect.Effect<void, RemoteError> {
    return effFromPromise('copyToVm', async () => {
      const content = readFileSync(localPath);
      const b64 = content.toString('base64');
      const dirPath = remotePath.substring(0, remotePath.lastIndexOf('/'));
      if (dirPath) {
        await this.sshImpl(vm, `mkdir -p ${JSON.stringify(dirPath)}`);
      }
      await this.sshImpl(vm, `echo '${b64}' | base64 -d > ${JSON.stringify(remotePath)}`);
    });
  }

  /** Copy a file from VM to local path */
  copyFromVm(vm: string, remotePath: string, localPath: string): Effect.Effect<void, RemoteError> {
    return effFromPromise('copyFromVm', async () => {
      const { appName } = await this.resolveVm(vm);
      await execAsync(
        `fly ssh sftp get -a ${JSON.stringify(appName)} ${JSON.stringify(remotePath)} ${JSON.stringify(localPath)}`,
        { timeout: 60000 }
      );
    });
  }

  /** Expose a port — not supported by Fly.io provider */
  exposePort(_vm: string, _port: number): Effect.Effect<string, RemoteError> {
    return Effect.fail(
      new RemoteError({
        operation: 'exposePort',
        message:
          'exposePort is not supported by the Fly.io provider. ' +
          'Configure services in fly.toml or via the Fly Machines API config.',
      }),
    );
  }

  /** Create a fly proxy tunnel to the machine */
  tunnel(
    vm: string,
    remotePort: number,
    localPort: number,
  ): Effect.Effect<{ close: () => void }, RemoteError> {
    return effFromPromise('tunnel', async () => {
      const { appName } = await this.resolveVm(vm);
      const child = spawn('fly', ['proxy', `${localPort}:${remotePort}`, '-a', appName], {
        env: { ...process.env },
      });

      return {
        close: () => {
          child.kill();
        },
      };
    });
  }

  // ============================================================================
  // Credential Sync & Configuration (ported from ExeProvider)
  // ============================================================================

  /**
   * Sync Claude Code credentials to the remote VM.
   * Linux stores them at ~/.claude/.credentials.json; macOS in the Keychain.
   */
  async syncClaudeCredentials(vmName: string): Promise<boolean> {
    try {
      let credentials = '';
      const credFile = join(homedir(), '.claude', '.credentials.json');
      if (existsSync(credFile)) {
        credentials = readFileSync(credFile, 'utf-8');
      } else {
        const { stdout } = await execAsync(
          'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
          { encoding: 'utf-8', timeout: 10000 }
        );
        credentials = stdout;
      }
      if (!credentials?.trim()) return false;

      const b64 = Buffer.from(credentials.trim()).toString('base64');
      await this.sshImpl(vmName, `mkdir -p ~/.claude && echo '${b64}' | base64 -d > ~/.claude/.credentials.json`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sync GitHub CLI authentication to the remote VM.
   *
   * Copying hosts.yml is not enough: gh commonly stores the token in the OS
   * keyring, leaving hosts.yml token-less. Export the live token via
   * `gh auth token` and log in on the VM, then wire gh as the git https
   * credential helper so clone/push authenticate.
   */
  async syncGitHubAuth(vmName: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('gh auth token', { timeout: 10000 });
      const token = stdout.trim();
      if (!token) return false;

      const b64 = Buffer.from(token).toString('base64');
      const result = await this.sshImpl(
        vmName,
        `echo '${b64}' | base64 -d | gh auth login --with-token && gh auth setup-git`
      );
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Sync GitLab CLI (glab) authentication to the remote VM */
  async syncGitLabAuth(vmName: string): Promise<boolean> {
    const glabConfigPath = join(homedir(), '.config', 'glab-cli', 'config.yml');
    if (!existsSync(glabConfigPath)) return false;

    try {
      const content = readFileSync(glabConfigPath, 'utf-8');
      const b64 = Buffer.from(content).toString('base64');
      await this.sshImpl(vmName, `mkdir -p ~/.config/glab-cli && echo '${b64}' | base64 -d > ~/.config/glab-cli/config.yml`);
      return true;
    } catch {
      return false;
    }
  }

  /** Sync all credentials needed for remote workspace operation */
  async syncAllCredentials(vmName: string): Promise<{ claude: boolean; github: boolean }> {
    const [claude, github] = await Promise.all([
      this.syncClaudeCredentials(vmName),
      this.syncGitHubAuth(vmName),
    ]);
    return { claude, github };
  }

  /** Install beads CLI (bd) on a remote VM */
  async installBeads(vmName: string): Promise<boolean> {
    // Check if already installed
    const check = await this.sshImpl(vmName, 'which bd 2>/dev/null');
    if (check.exitCode === 0 && check.stdout.trim()) return true;

    // Canonical install script (same source as the host prereqs registry).
    // Running as root it lands in /usr/local/bin, which stays on PATH even
    // under the Machines exec HOME=/ quirk.
    const result = await this.sshImpl(
      vmName,
      'curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash 2>&1'
    );
    if (result.exitCode !== 0) return false;
    const verify = await this.sshImpl(vmName, 'which bd 2>/dev/null');
    return verify.exitCode === 0 && verify.stdout.trim().length > 0;
  }

  /** Initialize beads in a workspace on a remote VM */
  async initBeads(vmName: string, workspacePath: string = '/workspace'): Promise<boolean> {
    // The cloned .beads/config.yaml carries the repo's sync.remote (an SSH
    // git URL). VMs are keyless — bd init tries to clone that remote and
    // fails before creating the local DB. Disable it: the host owns beads
    // sync; the VM's DB is a local working copy seeded from issues.jsonl.
    await this.sshImpl(
      vmName,
      `cd ${workspacePath} && [ -f .beads/config.yaml ] && sed -i 's|^sync.remote:|# vm-local (keyless): sync.remote:|' .beads/config.yaml || true`
    );
    // --from-jsonl seeds the DB from the synced issues.jsonl; the default
    // init imports from git history, which fetches the beads remote and
    // fails on keyless VMs (and its failed clone destroys .beads working
    // files, including the just-synced issues.jsonl).
    const result = await this.sshImpl(
      vmName,
      `cd ${workspacePath} && (bd init --prefix PAN --from-jsonl --non-interactive 2>&1 || bd init --from-jsonl --non-interactive 2>&1)`
    );
    return result.exitCode === 0;
  }

  /** Configure Claude Code on a VM for autonomous operation */
  async configureClaudeCode(vmName: string): Promise<void> {
    await this.sshImpl(vmName, 'mkdir -p ~/.claude');

    // Set onboarding complete + pre-trust /workspace so the agent doesn't
    // hang at the "do you trust this folder?" dialog on first launch.
    const onboardingScript = `
import json, os
path = os.path.expanduser("~/.claude.json")
data = {}
if os.path.exists(path):
    with open(path) as f:
        data = json.load(f)
data["hasCompletedOnboarding"] = True
data["lastOnboardingVersion"] = "2.0.50"
projects = data.setdefault("projects", {})
ws = projects.setdefault("/workspace", {})
ws["hasTrustDialogAccepted"] = True
with open(path, "w") as f:
    json.dump(data, f, indent=2)
`;
    const scriptB64 = Buffer.from(onboardingScript).toString('base64');
    await this.sshImpl(vmName, `echo '${scriptB64}' | base64 -d | python3`);

    // Write ~/.claude/settings.json honoring the user's Overdeck permission mode.
    // The defaultMode here is the fallback applied to any `claude` invocation on the
    // VM that doesn't pass --permission-mode; hardcoding bypass would silently
    // escalate any unflagged invocation even when the user has chosen Auto.
    const settings = JSON.stringify(buildClaudeUserSettingsSync());
    const settingsB64 = Buffer.from(settings).toString('base64');
    await this.sshImpl(vmName, `echo '${settingsB64}' | base64 -d > ~/.claude/settings.json`);

    const localMcpPath = join(homedir(), '.claude', 'mcp.json');
    if (existsSync(localMcpPath)) {
      try {
        const localMcpConfig = JSON.parse(readFileSync(localMcpPath, 'utf-8'));
        const remoteMcpConfig = getIsolatedPlaywrightMcpConfigSync(localMcpConfig);
        if (remoteMcpConfig) {
          const mcpB64 = Buffer.from(JSON.stringify(remoteMcpConfig, null, 2) + '\n').toString('base64');
          await this.sshImpl(vmName, `echo '${mcpB64}' | base64 -d > ~/.claude/mcp.json`);
        }
      } catch {
        // Non-fatal: remote Claude Code can still run without local MCP mirroring
      }
    }
  }

  /** Copy essential skills from local ~/.overdeck/skills/ to remote VM */
  async copySkillsToVm(vmName: string): Promise<void> {
    const skillsDir = join(homedir(), '.overdeck', 'skills');
    if (!existsSync(skillsDir)) return;

    await this.sshImpl(vmName, 'mkdir -p ~/.claude/skills');

    try {
      const entries = readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const localPath = join(skillsDir, entry.name);
        const content = readFileSync(localPath, 'utf-8');
        const b64 = Buffer.from(content).toString('base64');
        await this.sshImpl(vmName, `echo '${b64}' | base64 -d > ~/.claude/skills/${entry.name}`);
      }
    } catch {
      // Non-fatal: skills are optional
    }
  }

  /** Sync beads from remote VM to git: exports JSONL, commits, and pushes */
  async syncBeadsToGit(
    vmName: string,
    workspacePath: string = '/workspace',
    commitMessage?: string
  ): Promise<boolean> {
    const msg = commitMessage ?? 'chore: sync beads from remote';

    // Export beads to JSONL
    const exportResult = await this.sshImpl(
      vmName,
      `cd ${workspacePath} && bd export --output .beads/issues.jsonl 2>&1`
    );
    if (exportResult.exitCode !== 0) {
      return false;
    }

    // Commit and push
    const gitResult = await this.sshImpl(
      vmName,
      `cd ${workspacePath} && git add .beads/ && git diff --cached --quiet || (git commit -m ${JSON.stringify(msg)} && git push origin HEAD) 2>&1`
    );
    return gitResult.exitCode === 0;
  }

  /** Query beads on a remote VM via bd search */
  async queryBeads(
    vmName: string,
    searchTerm: string,
    workspacePath: string = '/workspace'
  ): Promise<unknown[]> {
    const result = await this.sshImpl(
      vmName,
      `cd ${workspacePath} && bd search ${JSON.stringify(searchTerm)} --json 2>/dev/null || echo '[]'`
    );
    try {
      return JSON.parse(result.stdout.trim() || '[]');
    } catch {
      return [];
    }
  }

  /** Get the configured app name */
  getAppName(): string {
    return this.config.app;
  }
}

export function createFlyProvider(config?: FlyProviderConfig): FlyProvider {
  return new FlyProvider(config);
}
