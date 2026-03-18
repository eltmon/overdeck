/**
 * exe.dev Remote Provider
 *
 * Implements the RemoteProvider interface for exe.dev cloud VMs.
 * exe.dev provides affordable dev VMs with persistent storage.
 *
 * exe.dev uses an SSH-based API:
 * - `ssh exe.dev` - Access the CLI
 * - `ssh exe.dev new` - Create a new VM
 * - `ssh exe.dev ls` - List VMs
 * - `ssh vmname.exe.xyz` - SSH into a VM
 *
 * Pricing (as of 2025):
 * - Individual: $20/month, 8GB RAM
 * - Team: $25/month/user, 8GB RAM
 * - Enterprise: $30/month/user, 16GB RAM
 *
 * @see https://exe.dev/docs
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type {
  RemoteProvider,
  VmInfo,
  VmStatus,
  ExecResult,
} from './interface.js';

const execAsync = promisify(exec);

export interface ExeProviderConfig {
  /** Shared infrastructure VM name (for postgres, redis, traefik) */
  infraVm?: string;
}

/**
 * Parse exe.dev ls output for VM list
 * Format appears to be: vmname (status info)
 */
function parseVmList(output: string): VmInfo[] {
  const vms: VmInfo[] = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('Your VMs')) continue;

    // exe.dev format: "  • pan-pan-81-ws.exe.xyz - running (boldsoftware/exeuntu)"
    // Extract VM name (without .exe.xyz suffix) and status
    const match = trimmed.match(/[•\-]\s*([a-z0-9-]+)\.exe\.xyz\s*-\s*(\w+)/i);
    if (match) {
      const name = match[1];
      const statusText = match[2].toLowerCase();
      const status: VmStatus = statusText === 'running' ? 'running' :
                               statusText === 'stopped' ? 'stopped' : 'unknown';
      vms.push({ name, status });
    }
  }

  return vms;
}

/**
 * Check if SSH key is configured for exe.dev
 */
async function canSshToExeDev(): Promise<boolean> {
  try {
    // Try a quick command - ssh exe.dev ls should work if authenticated
    const { stdout } = await execAsync('ssh -o BatchMode=yes -o ConnectTimeout=5 exe.dev ls 2>&1', {
      timeout: 10000,
    });
    // If we get output without permission denied, we're good
    return !stdout.includes('Permission denied') && !stdout.includes('Host key verification failed');
  } catch (error: any) {
    // Check if it's just an empty list (which is fine)
    if (error.stdout && !error.stdout.includes('Permission denied')) {
      return true;
    }
    return false;
  }
}

export class ExeProvider implements RemoteProvider {
  readonly name = 'exe';
  private config: ExeProviderConfig;

  constructor(config: ExeProviderConfig = {}) {
    this.config = config;
  }

  /**
   * Check if user is authenticated with exe.dev
   * This checks if SSH key is configured and can connect
   */
  async isAuthenticated(): Promise<boolean> {
    return canSshToExeDev();
  }

  /**
   * Execute a command on the exe.dev CLI (via ssh exe.dev)
   */
  private async exeCmd(command: string): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execAsync(`ssh exe.dev ${command}`, {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
      };
    }
  }

  /**
   * Create a new VM on exe.dev
   */
  async createVm(name: string): Promise<VmInfo> {
    try {
      // exe.dev uses --name flag, and names must be valid hostnames
      const result = await this.exeCmd(`new --name=${name}`);

      if (result.exitCode !== 0) {
        throw new Error(`Failed to create VM: ${result.stderr}`);
      }

      // Wait a moment for VM to be ready
      await new Promise(resolve => setTimeout(resolve, 5000));

      return { name, status: 'running' };
    } catch (error: any) {
      throw new Error(`Failed to create VM ${name}: ${error.message}`);
    }
  }

  /**
   * Delete a VM on exe.dev
   */
  async deleteVm(name: string): Promise<void> {
    try {
      const result = await this.exeCmd(`rm ${name}`);

      if (result.exitCode !== 0 && !result.stderr.includes('not found')) {
        throw new Error(result.stderr);
      }
    } catch (error: any) {
      throw new Error(`Failed to delete VM ${name}: ${error.message}`);
    }
  }

  /**
   * List all VMs
   */
  async listVms(): Promise<VmInfo[]> {
    try {
      const result = await this.exeCmd('ls');

      if (result.exitCode !== 0) {
        throw new Error(result.stderr);
      }

      return parseVmList(result.stdout);
    } catch (error: any) {
      throw new Error(`Failed to list VMs: ${error.message}`);
    }
  }

  /**
   * Get VM status
   */
  async getStatus(name: string): Promise<VmStatus> {
    try {
      const vms = await this.listVms();
      const vm = vms.find(v => v.name === name);
      return vm?.status || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get detailed VM info
   */
  async getVmInfo(name: string): Promise<VmInfo | null> {
    try {
      const vms = await this.listVms();
      return vms.find(v => v.name === name) || null;
    } catch {
      return null;
    }
  }

  /**
   * Start a stopped VM
   * Note: exe.dev VMs are persistent and always running
   */
  async startVm(name: string): Promise<void> {
    // exe.dev VMs don't have start/stop - they're always running
    // Check if VM exists
    const status = await this.getStatus(name);
    if (status === 'unknown') {
      throw new Error(`VM ${name} not found`);
    }
  }

  /**
   * Stop a running VM
   * Note: exe.dev VMs are persistent - use rm to delete
   */
  async stopVm(name: string): Promise<void> {
    // exe.dev doesn't have stop - VMs are always running or deleted
    // We can implement "stop" as a no-op or throw
    console.warn(`exe.dev VMs cannot be stopped, only deleted. VM ${name} continues running.`);
  }

  /**
   * Execute a command on VM via SSH
   * SSH to vmname.exe.xyz
   */
  async ssh(vm: string, command: string): Promise<ExecResult> {
    try {
      const sshHost = `${vm}.exe.xyz`;
      const escapedCmd = command.replace(/"/g, '\\"');

      // Use -A for agent forwarding so the VM can access GitHub with user's SSH keys
      const { stdout, stderr } = await execAsync(`ssh -A ${sshHost} "${escapedCmd}"`, {
        timeout: 300000, // 5 minutes
        maxBuffer: 50 * 1024 * 1024, // 50MB
      });

      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
      };
    }
  }

  /**
   * Execute a command and stream output
   */
  async *sshStream(vm: string, command: string): AsyncIterable<string> {
    const sshHost = `${vm}.exe.xyz`;
    // Use -A for agent forwarding
    const child = spawn('ssh', ['-A', sshHost, command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    for await (const chunk of child.stdout) {
      yield chunk.toString();
    }

    for await (const chunk of child.stderr) {
      yield chunk.toString();
    }
  }

  /**
   * Copy file to VM
   */
  async copyToVm(vm: string, localPath: string, remotePath: string): Promise<void> {
    try {
      const sshHost = `${vm}.exe.xyz`;
      await execAsync(`scp "${localPath}" ${sshHost}:${remotePath}`, { timeout: 300000 });
    } catch (error: any) {
      throw new Error(`Failed to copy ${localPath} to ${vm}:${remotePath}: ${error.message}`);
    }
  }

  /**
   * Copy file from VM
   */
  async copyFromVm(vm: string, remotePath: string, localPath: string): Promise<void> {
    try {
      const sshHost = `${vm}.exe.xyz`;
      await execAsync(`scp ${sshHost}:${remotePath} "${localPath}"`, { timeout: 300000 });
    } catch (error: any) {
      throw new Error(`Failed to copy ${vm}:${remotePath} to ${localPath}: ${error.message}`);
    }
  }

  /**
   * Expose a port on VM (returns public URL)
   *
   * exe.dev provides automatic HTTPS URLs for services:
   * https://vmname.exe.xyz:PORT
   */
  async exposePort(vm: string, port: number): Promise<string> {
    // exe.dev automatically exposes all ports via HTTPS
    // The URL format is: https://vmname.exe.xyz:PORT
    // Or for default HTTP (80/443): https://vmname.exe.xyz
    if (port === 80 || port === 443) {
      return `https://${vm}.exe.xyz`;
    }
    return `https://${vm}.exe.xyz:${port}`;
  }

  /**
   * Create SSH tunnel to VM
   */
  async tunnel(vm: string, remotePort: number, localPort: number): Promise<{ close: () => void }> {
    const sshHost = `${vm}.exe.xyz`;
    const child = spawn('ssh', ['-N', '-L', `${localPort}:localhost:${remotePort}`, sshHost], {
      stdio: 'ignore',
      detached: true,
    });

    child.unref();

    return {
      close: () => {
        child.kill();
      },
    };
  }

  /**
   * Get the configured infrastructure VM name
   */
  getInfraVm(): string | undefined {
    return this.config.infraVm;
  }

  /**
   * Initialize the shared infrastructure VM
   *
   * Sets up postgres, redis, and traefik on a dedicated VM.
   */
  async initInfrastructure(vmName: string): Promise<void> {
    // Check if VM exists
    let status = await this.getStatus(vmName);

    if (status === 'unknown') {
      // Create the VM
      await this.createVm(vmName);
      // Wait for it to be ready
      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    // Install Docker if not present
    const dockerCheck = await this.ssh(vmName, 'which docker');
    if (dockerCheck.exitCode !== 0) {
      await this.ssh(vmName, 'curl -fsSL https://get.docker.com | sh');
      await this.ssh(vmName, 'sudo usermod -aG docker $USER');
    }

    // Create docker-compose.yml for shared services
    const composeContent = `
version: '3.8'
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: \${PAN_POSTGRES_PASSWORD:-panopticon}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    restart: unless-stopped
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  traefik:
    image: traefik:v3.0
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command:
      - --api.dashboard=true
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443

volumes:
  postgres_data:
  redis_data:
`;

    // Write compose file and start services
    await this.ssh(vmName, `mkdir -p /opt/panopticon && cat > /opt/panopticon/docker-compose.yml << 'COMPOSE_EOF'
${composeContent}
COMPOSE_EOF`);

    await this.ssh(vmName, 'cd /opt/panopticon && docker compose up -d');

    // Store as infra VM
    this.config.infraVm = vmName;
  }

  /**
   * Sync Claude Code credentials from local macOS Keychain to remote VM
   *
   * This should be called before spawning agents to ensure fresh credentials.
   * Credentials can expire, and re-running this ensures the VM has valid auth.
   *
   * @returns true if credentials were synced, false if not available
   */
  async syncClaudeCredentials(vmName: string): Promise<boolean> {
    try {
      // Get credentials from macOS Keychain
      const { stdout: credentials } = await execAsync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8' }
      );

      if (!credentials || !credentials.trim()) {
        return false;
      }

      // Ensure ~/.claude directory exists
      await this.ssh(vmName, 'mkdir -p ~/.claude');

      // Send credentials to VM (base64 encode to handle special characters)
      const credsBase64 = Buffer.from(credentials.trim()).toString('base64');
      const result = await this.ssh(vmName, `echo '${credsBase64}' | base64 -d > ~/.claude/.credentials.json`);

      return result.exitCode === 0;
    } catch (error: any) {
      // Credentials not found in Keychain or other error
      return false;
    }
  }

  /**
   * Sync GitHub CLI authentication from local macOS to remote VM
   *
   * GitHub CLI on macOS stores tokens in Keychain. On Linux VMs, it stores
   * them directly in ~/.config/gh/hosts.yml. This extracts from Keychain
   * and writes to the VM's config file.
   *
   * @returns true if auth was synced, false if not available
   */
  async syncGitHubAuth(vmName: string): Promise<boolean> {
    try {
      // Get GitHub token from macOS Keychain
      const { stdout: tokenRaw } = await execAsync(
        'security find-generic-password -s "gh:github.com" -w 2>/dev/null',
        { encoding: 'utf-8' }
      );

      if (!tokenRaw || !tokenRaw.trim()) {
        return false;
      }

      // The token may be base64-encoded with go-keyring prefix
      let token = tokenRaw.trim();
      if (token.startsWith('go-keyring-base64:')) {
        token = Buffer.from(token.replace('go-keyring-base64:', ''), 'base64').toString('utf-8');
      }

      // Get GitHub username from local config
      let username = 'user';
      try {
        const { stdout: configOutput } = await execAsync('cat ~/.config/gh/hosts.yml 2>/dev/null', { encoding: 'utf-8' });
        const userMatch = configOutput.match(/user:\s*(\S+)/);
        if (userMatch) {
          username = userMatch[1];
        }
      } catch {
        // Use default
      }

      // Create hosts.yml content for Linux (token stored directly in file)
      const hostsYml = `github.com:
    oauth_token: ${token}
    git_protocol: ssh
    user: ${username}
`;

      // Ensure ~/.config/gh directory exists and write hosts.yml
      await this.ssh(vmName, 'mkdir -p ~/.config/gh');
      const hostsBase64 = Buffer.from(hostsYml).toString('base64');
      const result = await this.ssh(vmName, `echo '${hostsBase64}' | base64 -d > ~/.config/gh/hosts.yml && chmod 600 ~/.config/gh/hosts.yml`);

      return result.exitCode === 0;
    } catch (error: any) {
      // Token not found in Keychain or other error
      return false;
    }
  }

  /**
   * Sync GitLab CLI (glab) authentication to a remote VM
   *
   * Copies the glab config from local machine to the remote VM.
   * This allows the remote agent to use glab commands for MRs, etc.
   */
  async syncGitLabAuth(vmName: string): Promise<boolean> {
    try {
      // glab stores config in ~/.config/glab-cli/config.yml
      const glabConfigPath = join(homedir(), '.config', 'glab-cli', 'config.yml');

      if (!existsSync(glabConfigPath)) {
        console.log(`[exe-provider] No glab config found at ${glabConfigPath}`);
        return false;
      }

      // Read local glab config
      const glabConfig = readFileSync(glabConfigPath, 'utf-8');

      // Ensure ~/.config/glab-cli directory exists on remote
      await this.ssh(vmName, 'mkdir -p ~/.config/glab-cli');

      // Write config to remote
      const configBase64 = Buffer.from(glabConfig).toString('base64');
      const result = await this.ssh(vmName, `echo '${configBase64}' | base64 -d > ~/.config/glab-cli/config.yml && chmod 600 ~/.config/glab-cli/config.yml`);

      if (result.exitCode === 0) {
        console.log(`[exe-provider] GitLab auth synced to ${vmName}`);
        return true;
      }

      return false;
    } catch (error: any) {
      console.error(`[exe-provider] Failed to sync GitLab auth: ${error.message}`);
      return false;
    }
  }

  /**
   * Sync all credentials needed for remote workspace operation
   *
   * This syncs:
   * - Claude Code OAuth credentials
   * - GitHub CLI authentication
   *
   * Call this before spawning agents to ensure fresh credentials.
   *
   * @returns object with sync status for each credential type
   */
  async syncAllCredentials(vmName: string): Promise<{
    claude: boolean;
    github: boolean;
  }> {
    const [claude, github] = await Promise.all([
      this.syncClaudeCredentials(vmName),
      this.syncGitHubAuth(vmName),
    ]);

    return { claude, github };
  }

  /**
   * Install beads CLI (bd) on a remote VM
   *
   * Beads is required for planning agents to create task breakdowns.
   * Downloads the binary from GitHub releases since npm/node are often
   * not available on exe.dev VMs.
   *
   * @returns true if bd is available (already installed or just installed)
   */
  async installBeads(vmName: string): Promise<boolean> {
    const FALLBACK_BEADS_VERSION = '0.49.4';

    try {
      // Check if bd is already installed
      const checkResult = await this.ssh(vmName, 'which bd');
      if (checkResult.exitCode === 0 && checkResult.stdout.trim()) {
        console.log(`[exe-provider] bd already installed on ${vmName}`);
        return true;
      }

      console.log(`[exe-provider] Installing bd (beads CLI) on ${vmName}...`);

      // Download from GitHub releases - exe.dev VMs typically don't have npm/node
      // but do have curl and sudo access.
      // Resolve the latest version dynamically with fallback to known-good version.
      const installCmd = `
        cd /tmp && \
        BEADS_VERSION=$(curl -sI "https://github.com/steveyegge/beads/releases/latest" 2>/dev/null | grep -i '^location:' | sed 's|.*/v||' | tr -d '\\r\\n') && \
        if [ -z "$BEADS_VERSION" ]; then BEADS_VERSION="${FALLBACK_BEADS_VERSION}"; echo "Using fallback version: $BEADS_VERSION"; else echo "Detected version: $BEADS_VERSION"; fi && \
        echo "Downloading beads v$BEADS_VERSION..." && \
        curl -sL "https://github.com/steveyegge/beads/releases/download/v\${BEADS_VERSION}/beads_\${BEADS_VERSION}_linux_amd64.tar.gz" -o beads.tar.gz && \
        tar -xzf beads.tar.gz && \
        sudo mv bd /usr/local/bin/ && \
        rm -f beads.tar.gz CHANGELOG.md LICENSE README.md
      `.trim().replace(/\n\s+/g, ' ');

      const installResult = await this.ssh(vmName, installCmd);
      if (installResult.stderr) {
        console.log(`[exe-provider] bd install stderr on ${vmName}: ${installResult.stderr}`);
      }
      if (installResult.stdout) {
        console.log(`[exe-provider] bd install output on ${vmName}: ${installResult.stdout.trim()}`);
      }

      // Verify installation
      const verifyResult = await this.ssh(vmName, 'which bd && bd --version');
      if (verifyResult.exitCode === 0 && verifyResult.stdout.includes('bd version')) {
        console.log(`[exe-provider] bd installed successfully on ${vmName}: ${verifyResult.stdout.trim()}`);
        return true;
      }

      console.warn(`[exe-provider] Failed to install bd on ${vmName} - verify exitCode: ${verifyResult.exitCode}, stdout: ${verifyResult.stdout}, stderr: ${verifyResult.stderr}`);
      return false;
    } catch (error: any) {
      console.error(`[exe-provider] Error installing bd on ${vmName}:`, error.message);
      return false;
    }
  }

  /**
   * Initialize beads in a workspace on a remote VM
   *
   * Creates .beads/ directory and initializes the database if needed.
   */
  async initBeads(vmName: string, workspacePath: string = '/workspace'): Promise<boolean> {
    try {
      // Check if .beads already exists
      const checkResult = await this.ssh(vmName, `test -d ${workspacePath}/.beads && echo "exists"`);
      if (checkResult.stdout.includes('exists')) {
        console.log(`[exe-provider] .beads already initialized on ${vmName}`);
        return true;
      }

      console.log(`[exe-provider] Initializing beads on ${vmName}...`);

      // Initialize beads in the workspace
      const initResult = await this.ssh(vmName, `cd ${workspacePath} && bd init 2>/dev/null || true`);

      // Verify
      const verifyResult = await this.ssh(vmName, `test -d ${workspacePath}/.beads && echo "ok"`);
      if (verifyResult.stdout.includes('ok')) {
        console.log(`[exe-provider] beads initialized on ${vmName}`);
        return true;
      }

      // If bd init failed, create the directory manually
      await this.ssh(vmName, `mkdir -p ${workspacePath}/.beads`);
      return true;
    } catch (error: any) {
      console.error(`[exe-provider] Error initializing beads on ${vmName}:`, error.message);
      return false;
    }
  }

  /**
   * Sync beads from remote VM to git
   *
   * Exports beads database to JSONL, commits, and pushes.
   * This should be called after planning completes to persist tasks.
   */
  async syncBeadsToGit(vmName: string, workspacePath: string = '/workspace', commitMessage?: string): Promise<boolean> {
    try {
      console.log(`[exe-provider] Syncing beads to git on ${vmName}...`);

      // Export beads to JSONL
      const syncResult = await this.ssh(vmName, `cd ${workspacePath} && bd sync 2>/dev/null || true`);

      // Check if there are changes to commit
      const statusResult = await this.ssh(vmName, `cd ${workspacePath} && git status --porcelain .beads/ .planning/ 2>/dev/null`);

      if (!statusResult.stdout.trim()) {
        console.log(`[exe-provider] No beads changes to commit on ${vmName}`);
        return true;
      }

      // Add and commit
      const msg = commitMessage || 'Sync beads from planning session';
      await this.ssh(vmName, `cd ${workspacePath} && git add .beads/ && git add -f .planning/ 2>/dev/null || true`);
      await this.ssh(vmName, `cd ${workspacePath} && git commit -m "${msg}" 2>/dev/null || true`);

      // Push - use -u to set upstream if not already set
      const branchResult = await this.ssh(vmName, `cd ${workspacePath} && git branch --show-current`);
      const branch = branchResult.stdout.trim() || 'main';
      const pushResult = await this.ssh(vmName, `cd ${workspacePath} && git push -u origin ${branch} 2>&1`);
      if (pushResult.exitCode !== 0) {
        console.warn(`[exe-provider] Git push failed on ${vmName}: ${pushResult.stderr || pushResult.stdout}`);
        return false;
      }

      console.log(`[exe-provider] Beads synced and pushed from ${vmName}`);
      return true;
    } catch (error: any) {
      console.error(`[exe-provider] Error syncing beads on ${vmName}:`, error.message);
      return false;
    }
  }

  /**
   * Query beads on a remote VM
   *
   * Runs bd search on the remote and returns results.
   */
  async queryBeads(vmName: string, searchTerm: string, workspacePath: string = '/workspace'): Promise<any[]> {
    try {
      const result = await this.ssh(vmName, `cd ${workspacePath} && bd search "${searchTerm}" --json 2>/dev/null || echo "[]"`);

      if (result.exitCode !== 0 || !result.stdout.trim()) {
        return [];
      }

      try {
        return JSON.parse(result.stdout.trim());
      } catch {
        return [];
      }
    } catch (error: any) {
      console.error(`[exe-provider] Error querying beads on ${vmName}:`, error.message);
      return [];
    }
  }

  /**
   * Configure Claude Code on a VM for autonomous operation
   *
   * Sets up:
   * - ~/.claude.json with bypass permissions and onboarding settings
   * - ~/.bashrc with proper terminal environment (TERM, LANG, etc.)
   *
   * This is required for remote agents to run without human interaction.
   */
  async configureClaudeCode(vmName: string): Promise<void> {
    // Configure Claude settings
    const setupScript = `
import json, os
path = os.path.expanduser("~/.claude.json")
data = {}
if os.path.exists(path):
    with open(path, "r") as f:
        data = json.load(f)
data["bypassPermissionsModeAccepted"] = True
data["hasCompletedOnboarding"] = True
with open(path, "w") as f:
    json.dump(data, f, indent=2)
`;
    const scriptBase64 = Buffer.from(setupScript).toString('base64');
    const result = await this.ssh(vmName, `echo '${scriptBase64}' | base64 -d | python3`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to configure Claude Code on ${vmName}: ${result.stderr}`);
    }

    // Configure terminal environment in .bashrc for proper rendering
    const termEnv = `
# Panopticon terminal settings
export TERM=xterm-256color
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export COLORTERM=truecolor
`;
    const termEnvBase64 = Buffer.from(termEnv).toString('base64');
    await this.ssh(vmName, `grep -q "Panopticon terminal settings" ~/.bashrc 2>/dev/null || echo '${termEnvBase64}' | base64 -d >> ~/.bashrc`);
  }

  /**
   * Copy essential skills from local ~/.panopticon/skills/ to remote VM ~/.claude/skills/
   *
   * Skills are read locally and written to the VM via base64-encoded SSH.
   * Only copies SKILL.md and resource files (not symlinks or deep directories).
   */
  async copySkillsToVm(vmName: string): Promise<void> {
    const essentialSkills = [
      'beads',
      'beads-completion-check',
      'beads-panopticon-guide',
      'work-complete',
      'session-health',
    ];

    const skillsSourceDir = join(homedir(), '.panopticon', 'skills');
    if (!existsSync(skillsSourceDir)) {
      console.log(`[exe-provider] No skills source directory at ${skillsSourceDir}`);
      return;
    }

    // Create skills directory on remote
    await this.ssh(vmName, 'mkdir -p ~/.claude/skills');

    for (const skillName of essentialSkills) {
      const skillDir = join(skillsSourceDir, skillName);
      if (!existsSync(skillDir)) {
        continue;
      }

      try {
        // Create skill directory on remote
        await this.ssh(vmName, `mkdir -p ~/.claude/skills/${skillName}`);

        // Copy SKILL.md
        const skillMdPath = join(skillDir, 'SKILL.md');
        if (existsSync(skillMdPath)) {
          const content = readFileSync(skillMdPath, 'utf-8');
          const contentBase64 = Buffer.from(content).toString('base64');
          await this.ssh(vmName, `echo '${contentBase64}' | base64 -d > ~/.claude/skills/${skillName}/SKILL.md`);
        }

        // Copy resources/ directory if it exists
        const resourcesDir = join(skillDir, 'resources');
        if (existsSync(resourcesDir) && statSync(resourcesDir).isDirectory()) {
          await this.ssh(vmName, `mkdir -p ~/.claude/skills/${skillName}/resources`);
          const resourceFiles = readdirSync(resourcesDir).filter(f => f.endsWith('.md'));
          for (const resourceFile of resourceFiles) {
            const resourcePath = join(resourcesDir, resourceFile);
            if (statSync(resourcePath).isFile()) {
              const resourceContent = readFileSync(resourcePath, 'utf-8');
              const resourceBase64 = Buffer.from(resourceContent).toString('base64');
              await this.ssh(vmName, `echo '${resourceBase64}' | base64 -d > ~/.claude/skills/${skillName}/resources/${resourceFile}`);
            }
          }
        }

        console.log(`[exe-provider] Copied skill ${skillName} to ${vmName}`);
      } catch (error: any) {
        console.warn(`[exe-provider] Failed to copy skill ${skillName} to ${vmName}: ${error.message}`);
      }
    }
  }
}

/**
 * Factory function to create an ExeProvider with config from Panopticon settings
 */
export function createExeProvider(config?: ExeProviderConfig): ExeProvider {
  return new ExeProvider(config);
}
