/**
 * PAN-4927 W-INJ1 (PAN-4932): give a Claude Code launch the overdeck MCP server with its owner's token file (D-2, D-3, D-4).
 *
 * Every launch site spreads `await prepareClaudeOverdeckMcp(owner)` into its
 * `generateLauncherScript` config. The helper mints (or reuses) the owner's agent
 * token, writes `<dir>/overdeck-mcp.json` next to `<dir>/mcp-token`, and returns
 * its path. The config names only the token file; the token never leaves `mcp-token`.
 * It returns `{}` when injection is off and never throws: a failed mint starts the
 * agent without the server and logs one warning.
 * The file is Claude Code's `--mcp-config` format; the ACP host reads the same file and converts it (PAN-4934).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentRole } from '@overdeck/contracts';
import type { RuntimeName } from '../runtimes/types.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { loadConfigNoMigration } from '../config-yaml.js';
import { getDashboardLoopbackApiUrl } from '../config.js';
import { getOverdeckHome } from '../paths.js';
import { panCliInvocation } from '../pan-cli-invocation.js';
import { getAgentDir } from '../agents/agent-state-read.js';
import { normalizeAgentId } from '../agents/identity.js';
import { FLYWHEEL_CONVERSATION_SESSION } from '../flywheel/constants.js';
import { ensureAgentMcpToken, type AgentTokenRole } from './agent-token.js';
import { CLAUDE_OVERDECK_MCP_CONFIG_FILE, OVERDECK_MCP_SERVER_NAME } from './overdeck-mcp-args.js';

/** D-1: the harness declares `capabilities.overdeckMcp`. */
export function harnessGetsOverdeckMcp(harness: RuntimeName): boolean {
  return getHarnessBehavior(harness).capabilities.overdeckMcp;
}

/** FR-5: capability, not a Docker workspace, and config `mcp.agents`. */
export async function overdeckMcpEnabledFor(harness: RuntimeName, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!harnessGetsOverdeckMcp(harness)) return false;
  if (env.OVERDECK_DOCKER_WORKSPACE === '1' || env.PAN_DOCKER === '1') return false;
  return (await loadConfigNoMigration()).config.mcp.agents;
}

/** The stdio server entry: `pan mcp serve` with only paths and the loopback URL in env (C-6, C-7). */
export function overdeckStdioServer(tokenFile: string): { type: 'stdio'; command: string; args: string[]; env: Record<string, string> } {
  const { command, args } = panCliInvocation(['mcp', 'serve']);
  return {
    type: 'stdio',
    command,
    args,
    env: {
      OVERDECK_MCP_TOKEN_FILE: tokenFile,
      OVERDECK_HOME: getOverdeckHome(),
      OVERDECK_DASHBOARD_URL: getDashboardLoopbackApiUrl(),
    },
  };
}

/** Write `<dir>/overdeck-mcp.json` (mode 0600, temp file + rename) and return its path. */
export async function writeClaudeOverdeckMcpConfig(dir: string, tokenFile: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, CLAUDE_OVERDECK_MCP_CONFIG_FILE);
  const temp = `${path}.${randomUUID()}.tmp`;
  const body = JSON.stringify({ mcpServers: { [OVERDECK_MCP_SERVER_NAME]: overdeckStdioServer(tokenFile) } }, null, 2);
  try {
    await writeFile(temp, `${body}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return path;
}

/** D-4: the token role of a conversation launch. */
export function conversationTokenRole(row: { laneRole: string | null }, paneRole: AgentRole, tmuxSession: string): AgentTokenRole {
  if (row.laneRole !== null) return 'worker';
  if (tmuxSession === FLYWHEEL_CONVERSATION_SESSION) return 'flywheel';
  if (paneRole === 'uat') return 'test';
  return paneRole;
}

export interface OverdeckMcpLaunchOwner {
  agentId: string;
  agentKind: 'agent' | 'conversation';
  role: AgentTokenRole;
  harness: RuntimeName;
  /** Required for a conversation (its state dir); an agent defaults to its agent dir (D-5). */
  dir?: string;
}

/** Launch kinds whose command builder reads `overdeckMcpConfig`: Claude Code `--mcp-config=` and the ACP host's `--mcp-config` (PAN-4934). */
const OVERDECK_MCP_JSON_LAUNCH_KINDS: ReadonlySet<string> = new Set(['claude-code', 'acp-host']);

/** D-2/D-3: `{}` unless a Claude Code or ACP launch is enabled; never throws. */
export async function prepareClaudeOverdeckMcp(owner: OverdeckMcpLaunchOwner): Promise<{ overdeckMcpConfig?: string }> {
  if (!OVERDECK_MCP_JSON_LAUNCH_KINDS.has(getHarnessBehavior(owner.harness).launchCommandKind)) return {};
  try {
    if (!(await overdeckMcpEnabledFor(owner.harness))) return {};
    const dir = owner.dir ?? (owner.agentKind === 'agent' ? getAgentDir(normalizeAgentId(owner.agentId)) : undefined);
    if (dir === undefined) throw new Error('a conversation launch needs its state dir');
    const { tokenFile } = await ensureAgentMcpToken({ agentId: owner.agentId, agentKind: owner.agentKind, role: owner.role, dir });
    return { overdeckMcpConfig: await writeClaudeOverdeckMcpConfig(dir, tokenFile) };
  } catch (error) {
    console.warn(`[agent-injection] overdeck MCP skipped for ${owner.agentId}: ${(error as Error).message}`);
    return {};
  }
}
