/**
 * Lazy prerequisite registry — maps features to required tools and provides
 * per-tool check / install functions so the UI can prompt inline instead of
 * requiring a heavy `pan install` step before first use.
 */

import { exec, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import chalk from "chalk";
import { Effect } from "effect";
import { detectPlatform } from "../platform.js";
import { loadConfigSync } from "../config-yaml.js";
import { ensureSemgrepInstalled, managedSemgrepPath, readSemgrepVersion, SEMGREP_VERSION } from "../semgrep/install.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const PREREQ_REGISTRY = {
  addGitHubProject: ["gh"],
  addGitLabProject: ["glab"],
  spawnAgent: ["tmux"],
  openInteractiveTerminal: ["ttyd"],
  enableHttps: ["mkcert", "docker", "traefik"],
  runClaudeCodeHooks: ["jq"],
  useClaudeCodeRoutedAgents: [],
  useOxAgents: ["ox"],
  useSemgrep: ["semgrep"],
} as const;

export type PrereqFeature = keyof typeof PREREQ_REGISTRY;
export type PrereqTool = (typeof PREREQ_REGISTRY)[PrereqFeature][number];

/** Tools that have built-in auto-install support in the registry. */
export const INSTALLABLE_TOOLS: readonly PrereqTool[] = [
  "tmux",
  "ttyd",
  "mkcert",
  "jq",
  "ox",
  "semgrep",
];

async function checkCommand(cmd: string, args: string[] = ["--version"]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export type LinuxPackageManager = "pacman" | "dnf" | "zypper" | "apk" | "apt-get";
type LinuxPackageTool = "tmux" | "jq";
type CommandAvailable = (command: string) => Promise<boolean>;

const LINUX_PACKAGE_MANAGERS: readonly LinuxPackageManager[] = [
  "pacman",
  "dnf",
  "zypper",
  "apk",
  "apt-get",
];

export async function detectLinuxPackageManager(
  commandAvailable: CommandAvailable = checkCommand,
): Promise<LinuxPackageManager | null> {
  for (const packageManager of LINUX_PACKAGE_MANAGERS) {
    if (await commandAvailable(packageManager)) return packageManager;
  }
  return null;
}

export function getLinuxInstallCommand(
  tool: LinuxPackageTool,
  packageManager: LinuxPackageManager,
): string {
  switch (packageManager) {
    case "pacman":
      return `sudo pacman -S --noconfirm ${tool}`;
    case "dnf":
      return `sudo dnf install -y ${tool}`;
    case "zypper":
      return `sudo zypper install -y ${tool}`;
    case "apk":
      return `sudo apk add ${tool}`;
    case "apt-get":
      return `sudo apt-get update && sudo apt-get install -y ${tool}`;
  }
}

export function getLinuxManualInstallHint(
  tool: LinuxPackageTool,
  packageManager: LinuxPackageManager | null,
): string {
  if (packageManager) return getLinuxInstallCommand(tool, packageManager);
  const downloadUrl =
    tool === "jq"
      ? "https://jqlang.github.io/jq/download/"
      : "https://github.com/tmux/tmux/wiki/Installing";
  return `${tool} — download from ${downloadUrl}`;
}

async function installLinuxPackage(tool: LinuxPackageTool): Promise<void> {
  const packageManager = await detectLinuxPackageManager();
  if (!packageManager) {
    throw new Error(
      `No supported Linux package manager found. Install ${getLinuxManualInstallHint(tool, null)}`,
    );
  }
  await execAsync(getLinuxInstallCommand(tool, packageManager), { timeout: 120000 });
}

async function getManualInstallHint(tool: LinuxPackageTool): Promise<string> {
  const plat = await Effect.runPromise(detectPlatform());
  if (plat === "darwin") return `brew install ${tool}`;
  return getLinuxManualInstallHint(tool, await detectLinuxPackageManager());
}

export async function isToolInstalled(tool: PrereqTool): Promise<boolean> {
  if (tool === "docker") {
    return checkCommand("docker", ["info"]);
  }
  if (tool === "traefik") {
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["inspect", "--format", "{{.State.Running}}", "overdeck-traefik"],
        { timeout: 10_000 },
      );
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }
  if (tool === "ttyd") {
    return (
      await checkCommand("ttyd", ["--version"]) || existsSync(join(homedir(), "bin", "ttyd"))
    );
  }
  if (tool === "tmux") {
    // tmux has no --version; it only accepts -V (and exits 1 on --version).
    return checkCommand("tmux", ["-V"]);
  }
  if (tool === "semgrep") {
    // PAN-4585 (FR-1): no probe while the feature is off.
    if (!loadConfigSync().config.security.semgrep.enabled) return false;
    // The managed binary is ~/.overdeck/bin/semgrep, not a PATH entry.
    return (await readSemgrepVersion(managedSemgrepPath())) === SEMGREP_VERSION;
  }
  return checkCommand(tool);
}

export interface InstallResult {
  tool: PrereqTool;
  success: boolean;
  message: string;
}

/** Install a single tool. Returns a result object (never throws). */
export async function installTool(tool: PrereqTool): Promise<InstallResult> {
  try {
    switch (tool) {
      case "tmux":
        return await installTmux();
      case "ttyd":
        return await installTtyd();
      case "mkcert":
        return await installMkcert();
      case "jq":
        return await installJq();
      case "ox":
        return await installOx();
      case "semgrep":
        return await installSemgrep();
      default:
        return {
          tool,
          success: false,
          message: `Auto-install not available for ${tool}. Install it manually.`,
        };
    }
  } catch (error) {
    return {
      tool,
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Boot-time host-tool guarantee for `pan up`. tmux is fatal — no agent or
 * conversation session runs without it, so a failed install exits the process.
 * Optional integrations are best-effort. Already-present tools are silent no-ops.
 */
export async function ensureHostTools(): Promise<void> {
  const tools: Array<{ tool: LinuxPackageTool; label: string; fatal: boolean }> = [
    { tool: "tmux", label: "tmux", fatal: true },
    { tool: "jq", label: "jq", fatal: false },
  ];
  for (const { tool, label, fatal } of tools) {
    if (await isToolInstalled(tool)) continue;
    console.log(chalk.yellow(`  ${label} not found. Installing...`));
    const result = await installTool(tool);
    if (result.success) {
      console.log(chalk.green(`  ✓ ${result.message}`));
      continue;
    }
    console.error(
      fatal
        ? chalk.red(`  ✗ Failed to install ${label}: ${result.message}`)
        : chalk.yellow(`  ⚠ Failed to install ${label}: ${result.message}`),
    );
    const manual = await getManualInstallHint(tool);
    const context =
      tool === "jq"
        ? " — the Claude Code hooks (auto-approve, live status, cost tracking) need it."
        : "";
    console.error(chalk.dim(`  Install manually: ${manual}${context}`));
    if (fatal) process.exit(1);
  }
}

// ─── Per-tool installers ──────────────────────────────────────────────────────

async function installTmux(): Promise<InstallResult> {
  const plat = await Effect.runPromise(detectPlatform());
  if (plat === "darwin") {
    await execAsync("brew install tmux", { timeout: 120000 });
  } else {
    await installLinuxPackage("tmux");
  }
  return { tool: "tmux", success: true, message: "tmux installed" };
}

async function installTtyd(): Promise<InstallResult> {
  const plat = await Effect.runPromise(detectPlatform());
  const binDir = join(homedir(), "bin");
  mkdirSync(binDir, { recursive: true });
  const ttydPath = join(binDir, "ttyd");

  if (plat === "darwin") {
    try {
      await execAsync("brew install ttyd", { timeout: 120000 });
      return { tool: "ttyd", success: true, message: "ttyd installed via Homebrew" };
    } catch {
      // fall through to binary download
    }
  }

  await execAsync(
    `curl -sL "https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64" -o "${ttydPath}" && chmod +x "${ttydPath}"`,
    { timeout: 60000 }
  );
  return {
    tool: "ttyd",
    success: true,
    message: `ttyd installed to ${ttydPath}`,
  };
}

async function installMkcert(): Promise<InstallResult> {
  const plat = await Effect.runPromise(detectPlatform());
  if (plat === "darwin") {
    await execAsync("brew install mkcert", { timeout: 120000 });
    await execAsync("mkcert -install", { timeout: 30000 });
    return {
      tool: "mkcert",
      success: true,
      message: "mkcert installed via Homebrew and CA set up",
    };
  }

  const binDir = join(homedir(), ".local", "bin");
  mkdirSync(binDir, { recursive: true });
  const mkcertPath = join(binDir, "mkcert");
  const arch = process.arch === "x64" ? "amd64" : process.arch;

  await execAsync(
    `curl -sL "https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-${arch}" -o "${mkcertPath}" && chmod +x "${mkcertPath}"`,
    { timeout: 60000 }
  );
  await execAsync("mkcert -install", { timeout: 30000 });
  return {
    tool: "mkcert",
    success: true,
    message: `mkcert installed to ${mkcertPath} and CA set up`,
  };
}

async function installJq(): Promise<InstallResult> {
  const plat = await Effect.runPromise(detectPlatform());
  if (plat === "darwin") {
    await execAsync("brew install jq", { timeout: 120000 });
  } else {
    await installLinuxPackage("jq");
  }
  return { tool: "jq", success: true, message: "jq installed" };
}

async function installOx(): Promise<InstallResult> {
  const plat = await Effect.runPromise(detectPlatform());
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  const platform = plat === "darwin" ? "darwin" : "linux";
  const binDir = join(homedir(), ".local", "bin");
  const oxPath = join(binDir, "ox");
  mkdirSync(binDir, { recursive: true });

  await execAsync(
    `curl -sL "https://github.com/eltmon/ox/releases/download/latest/ox-${platform}-${arch}" -o "${oxPath}" && chmod +x "${oxPath}"`,
    { timeout: 60000 }
  );
  return {
    tool: "ox",
    success: true,
    message: "ox installed to ~/.local/bin/ox",
  };
}

async function installSemgrep(): Promise<InstallResult> {
  // PAN-4585 (FR-1): an explicit install still needs the feature switched on.
  if (!loadConfigSync().config.security.semgrep.enabled) {
    return {
      tool: "semgrep",
      success: false,
      message: "Semgrep support is off (security.semgrep.enabled: false in ~/.overdeck/config.yaml)",
    };
  }
  const outcome = await ensureSemgrepInstalled();
  return {
    tool: "semgrep",
    success: outcome.status === "present" || outcome.status === "installed",
    message: outcome.fix ? `${outcome.message} — ${outcome.fix}` : outcome.message,
  };
}
