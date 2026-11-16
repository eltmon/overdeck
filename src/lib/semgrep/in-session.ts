// PAN-4591: in-session Semgrep — the MCP server definition agents can call mid-edit.
import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { loadConfigNoMigration } from '../config-yaml.js';
import {
  SEMGREP_QUIET_ENV,
  inspectSemgrepLauncher,
  managedSemgrepPath,
  managedSemgrepTarget,
  semgrepToolsDir,
  type LauncherOccupant,
} from './install.js';

export const SEMGREP_MCP_SERVER_NAME = 'semgrep';

/** NFR-2: env for every in-session Semgrep process (MCP server and edit hook). */
export function semgrepInSessionEnv(home = getOverdeckHome()): Record<string, string> {
  const state = semgrepToolsDir(home);
  return {
    ...SEMGREP_QUIET_ENV,
    SEMGREP_SETTINGS_FILE: join(state, 'settings.yml'),
    SEMGREP_LOG_FILE: join(state, 'semgrep.log'),
  };
}

/** NFR-11: tools that fail without a login or with metrics off are removed. */
export const SEMGREP_MCP_DISABLED_TOOLS_ENV = {
  SEMGREP_SCAN_DISABLED: 'true',
  SEMGREP_FINDINGS_DISABLED: 'true',
  SEMGREP_SCAN_SUPPLY_CHAIN_DISABLED: 'true',
} as const;

export interface SemgrepMcpServer {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface SemgrepMcpOwner {
  agentId: string;
  agentKind: 'agent' | 'conversation';
  role: string;
  subRole?: string;
}

export interface SemgrepInSessionDeps {
  loadSemgrepConfig?: () => Promise<{ enabled?: boolean; mcp?: boolean; edit_hook?: boolean } | undefined>;
  home?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  inspectLauncher?: (linkPath: string, expectedTarget: string) => Promise<LauncherOccupant>;
  warn?: (line: string) => void;
}

/** True for an eligible MCP launch (Glossary): `work`, or `review` with sub-role `security`. */
export function isSemgrepMcpRole(owner: SemgrepMcpOwner): boolean {
  if (owner.agentKind !== 'agent') return false;
  return owner.role === 'work' || (owner.role === 'review' && owner.subRole === 'security');
}

async function defaultLoadSemgrepConfig(): Promise<{ enabled?: boolean; mcp?: boolean; edit_hook?: boolean } | undefined> {
  return (await loadConfigNoMigration()).config.security?.semgrep;
}

export async function resolveSemgrepMcpServer(
  owner: SemgrepMcpOwner,
  deps: SemgrepInSessionDeps = {},
): Promise<SemgrepMcpServer | null> {
  const cfg = await (deps.loadSemgrepConfig ?? defaultLoadSemgrepConfig)();
  if (cfg?.enabled !== true || cfg?.mcp !== true) return null;

  if (!isSemgrepMcpRole(owner)) return null;

  const env = deps.env ?? process.env;
  if (env.OVERDECK_DOCKER_WORKSPACE === '1' || env.PAN_DOCKER === '1') return null;

  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') return null;

  const home = deps.home ?? getOverdeckHome();
  const inspectLauncher = deps.inspectLauncher ?? inspectSemgrepLauncher;
  const occupant = await inspectLauncher(managedSemgrepPath(home), managedSemgrepTarget(home));
  if (occupant !== 'managed') {
    const warn = deps.warn ?? ((line: string) => console.warn(line));
    warn(`[semgrep] MCP server skipped for ${owner.agentId}: ~/.overdeck/bin/semgrep is missing or not the Overdeck-managed launcher; run pan sync`);
    return null;
  }

  return {
    type: 'stdio',
    command: '/usr/bin/env',
    args: ['-u', 'SEMGREP_APP_TOKEN', '-u', 'SEMGREP_RULES', managedSemgrepPath(home), 'mcp'],
    env: { ...semgrepInSessionEnv(home), SEMGREP_MCP_DISABLE_TRACING: 'true', ...SEMGREP_MCP_DISABLED_TOOLS_ENV },
  };
}
