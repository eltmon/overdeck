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
import { getIsolatedPlaywrightMcpConfig } from '../claude-mcp.js';
import { buildClaudeUserSettings } from '../claude-permissions.js';
import { FlyApiClient, createFlyApiClient, FlyApiError } from './fly-api.js';
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
}

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
    };
  }

  private getApi(): FlyApiClient {
    if (!this.api) {
      this.api = createFlyApiClient(this.config.apiToken || undefined);
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
    const workspacesDir = join(homedir(), '.panopticon', 'workspaces');
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

      // Create machine
      const machine = await api.createMachine(this.config.app, name, {
        image: this.config.image,
        size: this.config.vmSize,
        memory: this.config.vmMemory,
        region: this.config.region,
        restart: { policy: 'no' },
        auto_destroy: false,
      });

      // Wait for machine to start
      try {
        await api.waitForState(this.config.app, machine.id, 'started', 120);
      } catch {
        // Non-fatal: machine may still be starting
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
      await this.getApi().destroyMachine(appName, machineId);
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
        return { stdout: '', stderr: err.message, exitCode: 1 };
      }
      throw err;
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

  /** Sync Claude Code credentials from local macOS Keychain to remote VM */
  async syncClaudeCredentials(vmName: string): Promise<boolean> {
    try {
      const { stdout: credentials } = await execAsync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8', timeout: 10000 }
      );
      if (!credentials?.trim()) return false;

      const b64 = Buffer.from(credentials.trim()).toString('base64');
      await this.sshImpl(vmName, `mkdir -p ~/.claude && echo '${b64}' | base64 -d > ~/.claude/.credentials.json`);
      return true;
    } catch {
      return false;
    }
  }

  /** Sync GitHub CLI authentication to the remote VM */
  async syncGitHubAuth(vmName: string): Promise<boolean> {
    const ghConfigPath = join(homedir(), '.config', 'gh', 'hosts.yml');
    if (!existsSync(ghConfigPath)) return false;

    try {
      const content = readFileSync(ghConfigPath, 'utf-8');
      const b64 = Buffer.from(content).toString('base64');
      await this.sshImpl(vmName, `mkdir -p ~/.config/gh && echo '${b64}' | base64 -d > ~/.config/gh/hosts.yml`);
      return true;
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

    // Install via npm
    const result = await this.sshImpl(vmName, 'npm install -g @beads-dev/beads 2>&1');
    if (result.exitCode !== 0) {
      // Try alternative install
      const alt = await this.sshImpl(
        vmName,
        'curl -fsSL https://raw.githubusercontent.com/beads-dev/beads/main/install.sh | bash 2>&1'
      );
      return alt.exitCode === 0;
    }
    return true;
  }

  /** Initialize beads in a workspace on a remote VM */
  async initBeads(vmName: string, workspacePath: string = '/workspace'): Promise<boolean> {
    const result = await this.sshImpl(
      vmName,
      `cd ${workspacePath} && bd init --prefix PAN 2>&1 || bd init 2>&1`
    );
    return result.exitCode === 0;
  }

  /** Configure Claude Code on a VM for autonomous operation */
  async configureClaudeCode(vmName: string): Promise<void> {
    await this.sshImpl(vmName, 'mkdir -p ~/.claude');

    // Set onboarding complete
    const onboardingScript = `
import json, os
path = os.path.expanduser("~/.claude.json")
data = {}
if os.path.exists(path):
    with open(path) as f:
        data = json.load(f)
data["hasCompletedOnboarding"] = True
data["lastOnboardingVersion"] = "2.0.50"
with open(path, "w") as f:
    json.dump(data, f, indent=2)
`;
    const scriptB64 = Buffer.from(onboardingScript).toString('base64');
    await this.sshImpl(vmName, `echo '${scriptB64}' | base64 -d | python3`);

    // Write ~/.claude/settings.json honoring the user's Panopticon permission mode.
    // The defaultMode here is the fallback applied to any `claude` invocation on the
    // VM that doesn't pass --permission-mode; hardcoding bypass would silently
    // escalate any unflagged invocation even when the user has chosen Auto.
    const settings = JSON.stringify(buildClaudeUserSettings());
    const settingsB64 = Buffer.from(settings).toString('base64');
    await this.sshImpl(vmName, `echo '${settingsB64}' | base64 -d > ~/.claude/settings.json`);

    const localMcpPath = join(homedir(), '.claude', 'mcp.json');
    if (existsSync(localMcpPath)) {
      try {
        const localMcpConfig = JSON.parse(readFileSync(localMcpPath, 'utf-8'));
        const remoteMcpConfig = getIsolatedPlaywrightMcpConfig(localMcpConfig);
        if (remoteMcpConfig) {
          const mcpB64 = Buffer.from(JSON.stringify(remoteMcpConfig, null, 2) + '\n').toString('base64');
          await this.sshImpl(vmName, `echo '${mcpB64}' | base64 -d > ~/.claude/mcp.json`);
        }
      } catch {
        // Non-fatal: remote Claude Code can still run without local MCP mirroring
      }
    }
  }

  /** Copy essential skills from local ~/.panopticon/skills/ to remote VM */
  async copySkillsToVm(vmName: string): Promise<void> {
    const skillsDir = join(homedir(), '.panopticon', 'skills');
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
