/**
 * Host prerequisite detection for the dashboard setup checklist (PAN-774).
 *
 * Overdeck drives host tools — tmux sessions, the Claude Code CLI, git — that
 * no install flavor bundles (the desktop app ships only the dashboard). The
 * checks run from the SERVER process, so what they see on PATH is exactly what
 * spawned agents and conversations will see; a tool missing here is a tool
 * whose spawn will fail. Served by GET /api/prerequisites and rendered by the
 * frontend SetupChecklistBanner.
 *
 * Detection runs `<cmd> <versionArg>` directly (ENOENT = not installed),
 * which both proves the tool is executable and captures its version in one
 * probe. Install hints are copyable commands, not actions — installing system
 * packages needs sudo/user consent, so Overdeck never runs them itself.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PrerequisiteInstallHints {
  linux: string;
  mac: string;
  win: string;
}

export interface PrerequisiteDefinition {
  id: string;
  name: string;
  required: boolean;
  purpose: string;
  versionArgs: string[];
  install: PrerequisiteInstallHints;
}

export interface PrerequisiteCheck extends Omit<PrerequisiteDefinition, 'versionArgs'> {
  found: boolean;
  version: string | null;
}

export interface PrerequisitesReport {
  platform: NodeJS.Platform;
  allRequiredFound: boolean;
  checks: PrerequisiteCheck[];
}

export const PREREQUISITES: readonly PrerequisiteDefinition[] = [
  {
    id: 'tmux',
    name: 'tmux',
    required: true,
    purpose: 'Hosts every agent and conversation terminal session',
    versionArgs: ['-V'],
    install: {
      linux: 'sudo apt install tmux',
      mac: 'brew install tmux',
      win: 'Use WSL2 — inside your distro: sudo apt install tmux',
    },
  },
  {
    id: 'git',
    name: 'git',
    required: true,
    purpose: 'Projects, workspaces, and branch operations',
    versionArgs: ['--version'],
    install: {
      linux: 'sudo apt install git',
      mac: 'xcode-select --install',
      win: 'winget install Git.Git',
    },
  },
  {
    id: 'node',
    name: 'Node.js',
    required: true,
    purpose: 'Runs the Claude Code CLI and the PTY supervisor',
    versionArgs: ['--version'],
    install: {
      linux: 'Install Node 22+ from https://nodejs.org (or via nvm)',
      mac: 'brew install node@22',
      win: 'winget install OpenJS.NodeJS.LTS',
    },
  },
  {
    id: 'claude',
    name: 'Claude Code',
    required: true,
    purpose: 'The default agent harness — conversations and work agents run it',
    versionArgs: ['--version'],
    install: {
      linux: 'curl -fsSL https://claude.ai/install.sh | bash',
      mac: 'curl -fsSL https://claude.ai/install.sh | bash',
      win: 'npm install -g @anthropic-ai/claude-code',
    },
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    required: false,
    purpose: 'GitHub issue tracking and PR/CI status integration',
    versionArgs: ['--version'],
    install: {
      linux: 'sudo apt install gh',
      mac: 'brew install gh',
      win: 'winget install GitHub.cli',
    },
  },
  {
    id: 'bd',
    name: 'beads',
    required: false,
    purpose: 'Git-backed issue tracking used by the work pipeline',
    versionArgs: ['--version'],
    install: {
      linux: 'curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash',
      mac: 'brew install gastownhall/beads/bd',
      win: 'Use WSL2 — inside your distro, run the beads install script',
    },
  },
  {
    id: 'bun',
    name: 'Bun',
    required: false,
    purpose: 'Workspace installs for Bun-based projects (bun.lock / package_manager: bun)',
    versionArgs: ['--version'],
    install: {
      linux: 'curl -fsSL https://bun.sh/install | bash',
      mac: 'curl -fsSL https://bun.sh/install | bash',
      win: 'powershell -c "irm bun.sh/install.ps1 | iex"',
    },
  },
  {
    id: 'docker',
    name: 'Docker',
    required: false,
    // Traefik (the overdeck.localhost HTTPS proxy) runs as a Docker container,
    // so it needs no host install of its own — Docker is its prerequisite.
    purpose: 'Isolated workspace containers and the overdeck.localhost HTTPS proxy (Traefik)',
    versionArgs: ['--version'],
    install: {
      linux: 'https://docs.docker.com/engine/install/',
      mac: 'Install Docker Desktop — https://docker.com/products/docker-desktop',
      win: 'Install Docker Desktop — https://docker.com/products/docker-desktop',
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    required: false,
    purpose: 'OpenAI Codex harness — needed only for GPT-model agents',
    versionArgs: ['--version'],
    install: {
      linux: 'npm install -g @openai/codex',
      mac: 'npm install -g @openai/codex',
      win: 'npm install -g @openai/codex',
    },
  },
];

export type PrerequisiteProbe = (cmd: string, args: string[]) => Promise<string>;

const defaultProbe: PrerequisiteProbe = async (cmd, args) => {
  const { stdout } = await execFileAsync(cmd, args, { encoding: 'utf-8', timeout: 10_000 });
  return stdout;
};

function firstLine(output: string): string | null {
  const line = output.split('\n')[0]?.trim();
  return line || null;
}

export async function checkSystemPrerequisites(
  probe: PrerequisiteProbe = defaultProbe,
): Promise<PrerequisitesReport> {
  const checks = await Promise.all(
    PREREQUISITES.map(async ({ versionArgs, ...definition }): Promise<PrerequisiteCheck> => {
      try {
        const output = await probe(definition.id, versionArgs);
        return { ...definition, found: true, version: firstLine(output) };
      } catch {
        return { ...definition, found: false, version: null };
      }
    }),
  );
  return {
    platform: process.platform,
    allRequiredFound: checks.every((check) => check.found || !check.required),
    checks,
  };
}
