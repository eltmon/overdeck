/**
 * PAN-4927 W-INJ1 (PAN-4932): give a Claude Code launch the overdeck MCP server with its owner's token file (D-2, D-3, D-4).
 * PAN-4927 W-INJ2 (PAN-4933): same for Codex launches via `prepareCodexOverdeckMcp`, which merges into the role's `[mcp_servers]` map instead of a config file.
 *
 * Every launch site spreads `await prepareClaudeOverdeckMcp(owner)` into its
 * `generateLauncherScript` config. The helper mints (or reuses) the owner's agent
 * token, writes `<dir>/overdeck-mcp.json` next to `<dir>/mcp-token`, and returns
 * its path. The config names only the token file; the token never leaves `mcp-token`.
 * It returns `{}` when injection is off and never throws: a failed mint starts the
 * agent without the server and logs one warning.
 * The file is Claude Code's `--mcp-config` format; the ACP host reads the same file and converts it (PAN-4934).
 * PAN-5061: the same file also carries the launch project's `mcp_servers`, so it is written whenever at least one
 * server resolves, even when `mcp.agents` is off or the mint failed (D-3). Codex gets those servers in its server map.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentRole } from '@overdeck/contracts';
import type { RuntimeName } from '../runtimes/types.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { getDashboardLoopbackApiUrl } from '../config.js';
import { getOverdeckHome } from '../paths.js';
import { panCliInvocation } from '../pan-cli-invocation.js';
import { getAgentDir } from '../agents/agent-state-read.js';
import { normalizeAgentId } from '../agents/identity.js';
import { FLYWHEEL_CONVERSATION_SESSION } from '../flywheel/constants.js';
import { ensureAgentMcpToken, type AgentTokenRole } from './agent-token.js';
import { overdeckMcpEnabledFor } from './overdeck-mcp-gate.js';
import { resolveProjectMcpServers, type ProjectMcpServer } from '../projects/project-mcp.js';
import { CLAUDE_OVERDECK_MCP_CONFIG_FILE, OVERDECK_MCP_SERVER_NAME } from './overdeck-mcp-args.js';

export { harnessGetsOverdeckMcp, overdeckMcpEnabledFor } from './overdeck-mcp-gate.js';

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

/** Write `<dir>/overdeck-mcp.json` with `servers` (mode 0600, temp file + rename) and return its path. */
export async function writeLaunchMcpConfig(dir: string, servers: Record<string, unknown>): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, CLAUDE_OVERDECK_MCP_CONFIG_FILE);
  const temp = `${path}.${randomUUID()}.tmp`;
  const body = JSON.stringify({ mcpServers: servers }, null, 2);
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
  /** PAN-5061: the launch cwd; resolves the launch project. */
  cwd: string;
  /** PAN-5061: the launch's issue, when it has one; resolves the launch project first. */
  issueId?: string;
}

/** The launching role's own MCP server names; a project server with one of these names is dropped (D-4). */
async function roleServerNames(role: AgentTokenRole): Promise<string[]> {
  if (role === 'conversation') return [];
  try {
    const { parseRoleMcpServers, roleAgentDefinitionPath } = await import('../agents/runtime-command.js');
    return Object.keys(parseRoleMcpServers(roleAgentDefinitionPath(role)));
  } catch {
    return [];
  }
}

/** The launch project's resolved servers, with `overdeck` and the role's server names reserved. */
async function launchProjectServers(owner: OverdeckMcpLaunchOwner) {
  const reservedNames = [OVERDECK_MCP_SERVER_NAME, ...(await roleServerNames(owner.role))];
  return resolveProjectMcpServers({ issueId: owner.issueId, cwd: owner.cwd, reservedNames });
}

/** The owner's dir for the launch MCP file: `owner.dir`, else an agent's agent dir. */
function launchDir(owner: OverdeckMcpLaunchOwner): string | undefined {
  return owner.dir ?? (owner.agentKind === 'agent' ? getAgentDir(normalizeAgentId(owner.agentId)) : undefined);
}

/** Shared mint path: enabled check, owner dir resolution, and the token mint itself. */
async function mintOverdeckTokenFile(owner: OverdeckMcpLaunchOwner): Promise<{ dir: string; tokenFile: string } | null> {
  if (!(await overdeckMcpEnabledFor(owner.harness))) return null;
  const dir = launchDir(owner);
  if (dir === undefined) throw new Error('a conversation launch needs its state dir');
  const { tokenFile } = await ensureAgentMcpToken({ agentId: owner.agentId, agentKind: owner.agentKind, role: owner.role, dir });
  return { dir, tokenFile };
}

/** Launch kinds whose command builder reads `overdeckMcpConfig`: Claude Code `--mcp-config=` and the ACP host's `--mcp-config` (PAN-4934). */
const OVERDECK_MCP_JSON_LAUNCH_KINDS: ReadonlySet<string> = new Set(['claude-code', 'acp-host']);

/**
 * D-2/D-3 (PAN-5061): the launch MCP file for a Claude Code or ACP launch, holding the `overdeck` server when it
 * is enabled and minted plus the launch project's servers. `{}` when no server resolves; never throws.
 */
export async function prepareClaudeOverdeckMcp(
  owner: OverdeckMcpLaunchOwner,
): Promise<{ overdeckMcpConfig?: string; overdeckMcpServerNames?: string[]; mcpStrict?: boolean }> {
  const behavior = getHarnessBehavior(owner.harness);
  if (!OVERDECK_MCP_JSON_LAUNCH_KINDS.has(behavior.launchCommandKind)) {
    if (!behavior.usesCodexHome) await warnUnprovisionedProjectServers(owner);
    return {};
  }
  const servers: Record<string, unknown> = {};
  let dir: string | undefined;
  try {
    const minted = await mintOverdeckTokenFile(owner);
    if (minted !== null) {
      servers[OVERDECK_MCP_SERVER_NAME] = overdeckStdioServer(minted.tokenFile);
      dir = minted.dir;
    }
  } catch (error) {
    console.warn(`[agent-injection] overdeck MCP skipped for ${owner.agentId}: ${(error as Error).message}`);
  }
  try {
    const project = await launchProjectServers(owner);
    Object.assign(servers, project.servers);
    if (Object.keys(servers).length === 0) return {};
    dir ??= launchDir(owner);
    if (dir === undefined) throw new Error('a conversation launch needs its state dir');
    return {
      overdeckMcpConfig: await writeLaunchMcpConfig(dir, servers),
      // An overdeck-only file keeps the pre-PAN-5061 result; the launcher defaults to mcp__overdeck (NFR-1).
      ...(Object.keys(project.servers).length > 0 ? { overdeckMcpServerNames: Object.keys(servers) } : {}),
      ...(project.strict ? { mcpStrict: true } : {}),
    };
  } catch (error) {
    console.warn(`[agent-injection] project MCP skipped for ${owner.agentId}: ${(error as Error).message}`);
    return {};
  }
}

/** FR-8: a harness that provisions no MCP logs one warning naming the project servers it cannot use. */
async function warnUnprovisionedProjectServers(owner: OverdeckMcpLaunchOwner): Promise<void> {
  try {
    const { projectKey, servers } = await launchProjectServers(owner);
    const names = Object.keys(servers);
    if (names.length === 0) return;
    console.warn(`[project-mcp] ${projectKey}: harness ${owner.harness} does not provision MCP; servers unavailable: ${names.join(', ')}`);
  } catch {
    // Best effort: the warning never blocks a launch.
  }
}

/** A `[mcp_servers.<name>]` table entry a Codex launch merges into its server map: `overdeck` or a project server. */
export type CodexOverdeckMcpServer = ProjectMcpServer & { defaultToolsApprovalMode: 'approve' };

/**
 * PAN-4933 W-INJ2: `{}` unless the harness uses a Codex home; never throws.
 * PAN-5061: the map also carries the launch project's servers, each with `approve` like `overdeck`.
 * `defaultToolsApprovalMode: 'approve'` is required because Overdeck's MCP tools
 * carry no `readOnlyHint` annotations, so Codex would otherwise refuse every
 * model-initiated call under `approval_policy = "never"` (planning landmine,
 * see .overdeck/context/codebase/concerns.md).
 */
export async function prepareCodexOverdeckMcp(owner: OverdeckMcpLaunchOwner): Promise<Record<string, CodexOverdeckMcpServer>> {
  if (!getHarnessBehavior(owner.harness).usesCodexHome) return {};
  const servers: Record<string, CodexOverdeckMcpServer> = {};
  try {
    const minted = await mintOverdeckTokenFile(owner);
    if (minted !== null) servers[OVERDECK_MCP_SERVER_NAME] = { ...overdeckStdioServer(minted.tokenFile), defaultToolsApprovalMode: 'approve' };
  } catch (error) {
    console.warn(`[agent-injection] overdeck MCP skipped for ${owner.agentId}: ${(error as Error).message}`);
  }
  try {
    for (const [name, server] of Object.entries((await launchProjectServers(owner)).servers)) {
      servers[name] = { ...server, defaultToolsApprovalMode: 'approve' };
    }
  } catch (error) {
    console.warn(`[agent-injection] project MCP skipped for ${owner.agentId}: ${(error as Error).message}`);
  }
  return servers;
}
