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
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
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

export interface SetupDiagnosticsReport {
  schemaVersion: 1;
  markdown: string;
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
    id: 'jq',
    name: 'jq',
    required: false,
    purpose: "Powers Overdeck's Claude Code hooks (auto-approve, live status, cost tracking)",
    versionArgs: ['--version'],
    install: {
      linux: 'sudo apt install jq',
      mac: 'brew install jq',
      win: 'winget install jqlang.jq',
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

function redactHome(value: string, home = homedir()): string {
  return home && value.includes(home) ? value.replaceAll(home, '~') : value;
}

function failureKind(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  if (code === 'ENOENT') return 'command not found';
  if (code === 'EACCES') return 'permission denied';
  if (code === 'ETIMEDOUT') return 'probe timed out';
  return 'probe failed';
}

async function executablePath(command: string, pathValue: string): Promise<string | null> {
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return redactHome(candidate);
    } catch {
      // Continue through PATH. Diagnostics must remain best-effort.
    }
  }
  return null;
}

/** Build a bounded, secret-free support report from the dashboard process environment. */
export async function collectSetupDiagnostics(overdeckVersion: string): Promise<SetupDiagnosticsReport> {
  const pathValue = process.env['PATH'] ?? '';
  const toolLines = await Promise.all(PREREQUISITES.map(async ({ id, versionArgs }) => {
    const resolvedPath = await executablePath(id, pathValue);
    try {
      const output = await defaultProbe(id, versionArgs);
      return `✓ ${id}: ${firstLine(output) ?? 'version unavailable'} — ${resolvedPath ?? 'path unresolved'}`;
    } catch (error) {
      return `✗ ${id}: ${failureKind(error)}${resolvedPath ? ` — ${resolvedPath}` : ''}`;
    }
  }));

  const claudeCandidates = [
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.npm-global', 'bin', 'claude'),
    join(homedir(), '.bun', 'bin', 'claude'),
  ];
  const candidateLines = await Promise.all(claudeCandidates.map(async (candidate) => {
    try {
      await access(candidate, constants.X_OK);
      return `- ${redactHome(candidate)}: executable`;
    } catch {
      return `- ${redactHome(candidate)}: missing`;
    }
  }));
  const claudeOnPath = await executablePath('claude', pathValue);
  const candidateFound = candidateLines.some((line) => line.endsWith(': executable'));
  const likelyCause = !claudeOnPath && candidateFound
    ? 'Claude appears to be installed, but its directory is absent from the dashboard server PATH. Restart Overdeck after correcting PATH.'
    : !claudeOnPath
      ? 'The dashboard server cannot find a Claude executable on PATH or in the common user install locations checked.'
      : 'Claude is visible on the dashboard server PATH; use the probe result above if startup still fails.';

  const markdown = [
    '## Overdeck setup diagnostics',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Overdeck: ${overdeckVersion}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Node: ${process.version}`,
    `Shell: ${redactHome(process.env['SHELL'] ?? 'unknown')}`,
    `Server PATH: ${redactHome(pathValue) || 'empty'}`,
    '',
    '### Prerequisites',
    ...toolLines,
    '',
    '### Claude lookup',
    `Dashboard PATH lookup: ${claudeOnPath ?? 'not found'}`,
    'Common user install locations:',
    ...candidateLines,
    '',
    `Likely cause: ${likelyCause}`,
    '',
    '_Secrets, environment variable values other than PATH, credentials, project data, and raw error output are omitted._',
  ].join('\n');

  return { schemaVersion: 1, markdown: markdown.slice(0, 16_384) };
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
