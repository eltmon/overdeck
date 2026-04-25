/**
 * Lazy prerequisite registry — maps features to required tools and provides
 * per-tool check / install functions so the UI can prompt inline instead of
 * requiring a heavy `pan install` step before first use.
 */

import { exec, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { detectPlatform } from "../platform.js";

const execAsync = promisify(exec);

export const PREREQ_REGISTRY = {
  addGitHubProject: ["gh"],
  addGitLabProject: ["glab"],
  spawnAgent: ["tmux"],
  openInteractiveTerminal: ["ttyd"],
  enableHttps: ["mkcert", "docker", "traefik"],
  enableBeads: ["bd"],
  useClaudeCodeRoutedAgents: ["claudish"],
  useOxAgents: ["ox"],
} as const;

export type PrereqFeature = keyof typeof PREREQ_REGISTRY;
export type PrereqTool = (typeof PREREQ_REGISTRY)[PrereqFeature][number];

/** Tools that have built-in auto-install support in the registry. */
export const INSTALLABLE_TOOLS: readonly PrereqTool[] = [
  "tmux",
  "ttyd",
  "mkcert",
  "bd",
  "claudish",
  "ox",
];

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function isToolInstalled(tool: PrereqTool): Promise<boolean> {
  if (tool === "traefik") {
    // Traefik is Docker-based; we check for the Docker network instead
    return checkCommand("docker");
  }
  if (tool === "ttyd") {
    return (
      checkCommand("ttyd") || existsSync(join(homedir(), "bin", "ttyd"))
    );
  }
  return checkCommand(tool);
}

export async function getMissingToolsForFeature(
  feature: PrereqFeature
): Promise<PrereqTool[]> {
  const tools = PREREQ_REGISTRY[feature];
  const missing: PrereqTool[] = [];
  for (const tool of tools) {
    if (!(await isToolInstalled(tool))) {
      missing.push(tool);
    }
  }
  return missing;
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
      case "bd":
        return await installBeads();
      case "claudish":
        return await installClaudish();
      case "ox":
        return await installOx();
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

// ─── Per-tool installers ──────────────────────────────────────────────────────

async function installTmux(): Promise<InstallResult> {
  const plat = detectPlatform();
  if (plat === "darwin") {
    await execAsync("brew install tmux", { timeout: 120000 });
  } else {
    await execAsync("sudo apt-get update && sudo apt-get install -y tmux", {
      timeout: 120000,
    });
  }
  return { tool: "tmux", success: true, message: "tmux installed" };
}

async function installTtyd(): Promise<InstallResult> {
  const plat = detectPlatform();
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
  const plat = detectPlatform();
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

async function installBeads(): Promise<InstallResult> {
  const plat = detectPlatform();
  if (plat === "darwin") {
    try {
      await execAsync("brew install gastownhall/beads/bd", {
        timeout: 120000,
      });
      return {
        tool: "bd",
        success: true,
        message: "beads installed via Homebrew",
      };
    } catch {
      // fall through to curl script
    }
  }

  await execAsync(
    "curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash",
    { timeout: 120000 }
  );
  return {
    tool: "bd",
    success: true,
    message: "beads installed via install script",
  };
}

async function installClaudish(): Promise<InstallResult> {
  const plat = detectPlatform();
  if (plat === "darwin") {
    return {
      tool: "claudish",
      success: false,
      message: "Install manually: brew install eltmon/claudish/claudish",
    };
  }

  const arch =
    process.arch === "x64"
      ? "x64"
      : process.arch === "arm64"
        ? "arm64"
        : "x64";
  const binDir = join(homedir(), ".local", "bin");
  const claudishPath = join(binDir, "claudish");
  mkdirSync(binDir, { recursive: true });

  await execAsync(
    `curl -sL "https://github.com/eltmon/claudish/releases/latest/download/claudish-linux-${arch}" -o "${claudishPath}" && chmod +x "${claudishPath}"`,
    { timeout: 60000 }
  );
  return {
    tool: "claudish",
    success: true,
    message: "claudish installed to ~/.local/bin/claudish",
  };
}

async function installOx(): Promise<InstallResult> {
  const plat = detectPlatform();
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
